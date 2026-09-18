package main

import (
	"testing"
	"time"
)

func TestStoreRejectsLowBid(t *testing.T) {
	store := newStore()
	result, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user1", Amount: 25999, IdempotencyKey: "low-bid-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Accepted {
		t.Fatalf("expected low bid to be rejected")
	}
	if result.MinimumNext == 0 {
		t.Fatalf("expected minimum next bid to be set")
	}
}

func TestStoreAcceptsValidBid(t *testing.T) {
	store := newStore()
	result, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user2", Amount: 86000, IdempotencyKey: "valid-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected valid bid acceptance, got %+v", result)
	}
	if result.CurrentBid != 86000 {
		t.Fatalf("expected current bid to be 86000, got %d", result.CurrentBid)
	}
}

func TestStoreIdempotencyIsStable(t *testing.T) {
	store := newStore()
	first, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user3", Amount: 87000, IdempotencyKey: "dup-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	second, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user4", Amount: 88000, IdempotencyKey: "dup-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if first.BidID != second.BidID {
		t.Fatalf("expected same bid id for idempotent request, got %d and %d", first.BidID, second.BidID)
	}
	if second.CurrentBid != 87000 {
		t.Fatalf("expected idempotent request to return original result, got %d", second.CurrentBid)
	}
}

func TestStoreUsesRequestedAuctionID(t *testing.T) {
	store := newStore()
	result, err := store.placeBid(BidRequest{AuctionID: 2, Bidder: "user4", Amount: 121000, IdempotencyKey: "auction-2-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected bid on auction 2 to be accepted, got %+v", result)
	}
	if result.AuctionID != 2 {
		t.Fatalf("expected response to target auction 2, got %d", result.AuctionID)
	}
	if auction, ok := store.auctions[2]; !ok || auction.CurrentBid != 121000 {
		t.Fatalf("expected auction 2 current bid to update to 121000, got %+v", store.auctions[2])
	}
}

func TestStoreCreatesAuction(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{
		Title:         "Team Laptop",
		Description:   "A lightly used development laptop.",
		Category:      "Technology",
		StartingPrice: 50000,
		DurationHours: 24,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if auction.ID != 4 || auction.CurrentBid != 50000 || auction.Status != AuctionStatusUpcoming {
		t.Fatalf("unexpected created auction: %+v", auction)
	}
	if time.Until(auction.StartsAt) > 6*time.Second || time.Until(auction.StartsAt) < 4*time.Second {
		t.Fatalf("expected a 5-second countdown before auction starts, got starts_at=%s", auction.StartsAt.Format(time.RFC3339))
	}
}

func TestStoreDeletesAuctionWithoutBids(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Delete me", Category: "Test", StartingPrice: 1000, DurationMinutes: 10, OwnerWallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12"})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	if err := store.deleteAuction(auction.ID, "0xabcdef1234567890abcdef1234567890abcdef12"); err != nil {
		t.Fatalf("unexpected delete error: %v", err)
	}
	if _, ok := store.getAuction(auction.ID); ok {
		t.Fatalf("expected auction %d to be deleted", auction.ID)
	}
}

func TestStoreRejectsDeleteByNonOwner(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Owner only", Category: "Test", StartingPrice: 2500, DurationMinutes: 10, OwnerWallet: "0x1111111111111111111111111111111111111111"})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	if err := store.deleteAuction(auction.ID, "0x2222222222222222222222222222222222222222"); err == nil {
		t.Fatalf("expected non-owner delete to fail")
	}
	if _, ok := store.getAuction(auction.ID); !ok {
		t.Fatalf("expected auction %d to remain after unauthorized delete", auction.ID)
	}
}

func TestStoreDeletesAuctionWithBids(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Delete my sold item", Category: "Test", StartingPrice: 3000, DurationMinutes: 10, OwnerWallet: "0x3333333333333333333333333333333333333333"})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	if _, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user1", Amount: 35000, IdempotencyKey: "delete-protection"}); err != nil {
		t.Fatalf("unexpected bid error: %v", err)
	}
	if err := store.deleteAuction(auction.ID, "0x3333333333333333333333333333333333333333"); err != nil {
		t.Fatalf("expected auction with bids to be deleted: %v", err)
	}
	if _, ok := store.getAuction(auction.ID); ok {
		t.Fatalf("expected auction %d to be deleted", auction.ID)
	}
}

func TestStoreAcceptsAnonymousAlias(t *testing.T) {
	store := newStore()
	result, err := store.placeBid(BidRequest{AuctionID: 1, Amount: 90000, BidderAlias: "Nighthawk", IdempotencyKey: "alias-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected alias-based bid to be accepted, got %+v", result)
	}
	if result.AuctionID != 1 {
		t.Fatalf("expected response to target auction 1, got %d", result.AuctionID)
	}
	if got := store.auctions[1].CurrentBidder; got != "Nighthawk" {
		t.Fatalf("expected bidder alias to be stored, got %q", got)
	}
}

func TestStoreMetricsIncludeLoadAndThroughput(t *testing.T) {
	store := newStore()
	store.requests = 42
	store.rejected = 7
	store.nextBidID = 10
	store.bids = []Bid{{ID: 1, AuctionID: 1, Bidder: "user1", Amount: 26000, CreatedAt: time.Now().UTC()}, {ID: 2, AuctionID: 1, Bidder: "user2", Amount: 27000, CreatedAt: time.Now().UTC()}}

	metrics := store.getMetrics()
	if _, ok := metrics["requests_per_second"]; !ok {
		t.Fatalf("expected requests_per_second in metrics: %+v", metrics)
	}
	if _, ok := metrics["bids_per_second"]; !ok {
		t.Fatalf("expected bids_per_second in metrics: %+v", metrics)
	}
	if metrics["successful_bids"] != len(store.bids) {
		t.Fatalf("expected successful_bids to match bid count, got %+v", metrics)
	}
}
