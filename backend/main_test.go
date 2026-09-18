package main

import (
	"testing"
	"time"
)

func activateAuctionForTesting(store *Store, auction Auction) {
	auction.StartsAt = time.Now().Add(-time.Minute)
	auction.EndsAt = time.Now().Add(30 * time.Minute)
	auction.Status = AuctionStatusActive
	store.auctions[auction.ID] = &auction
}

func TestStoreRejectsLowBid(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Demo item", Category: "Test", StartingPrice: 25000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	result, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user1", Amount: 25000, IdempotencyKey: "low-bid-1"})
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
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Demo item", Category: "Test", StartingPrice: 70000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	result, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user2", Amount: 86000, IdempotencyKey: "valid-1"})
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

func TestStoreAcceptsAnyBidAboveCurrent(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Demo item", Category: "Test", StartingPrice: 75000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	result, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user-any", Amount: 85001, IdempotencyKey: "any-above-current"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected any amount above current bid to be accepted, got %+v", result)
	}
	if result.CurrentBid != 85001 {
		t.Fatalf("expected current bid to be 85001, got %d", result.CurrentBid)
	}
}

func TestStoreIdempotencyIsStable(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Demo item", Category: "Test", StartingPrice: 80000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	first, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user3", Amount: 87000, IdempotencyKey: "dup-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	second, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user4", Amount: 88000, IdempotencyKey: "dup-1"})
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
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Auction 2", Category: "Test", StartingPrice: 90000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	result, err := store.placeBid(BidRequest{AuctionID: auction.ID, Bidder: "user4", Amount: 121000, IdempotencyKey: "auction-2-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected bid on auction %d to be accepted, got %+v", auction.ID, result)
	}
	if result.AuctionID != auction.ID {
		t.Fatalf("expected response to target auction %d, got %d", auction.ID, result.AuctionID)
	}
	if stored, ok := store.auctions[auction.ID]; !ok || stored.CurrentBid != 121000 {
		t.Fatalf("expected auction %d current bid to update to 121000, got %+v", auction.ID, store.auctions[auction.ID])
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
	if auction.ID != 1 || auction.CurrentBid != 50000 || auction.Status != AuctionStatusUpcoming {
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
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Alias item", Category: "Test", StartingPrice: 85000, DurationMinutes: 30})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	activateAuctionForTesting(store, auction)
	result, err := store.placeBid(BidRequest{AuctionID: auction.ID, Amount: 90000, BidderAlias: "Nighthawk", IdempotencyKey: "alias-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected alias-based bid to be accepted, got %+v", result)
	}
	if result.AuctionID != auction.ID {
		t.Fatalf("expected response to target auction %d, got %d", auction.ID, result.AuctionID)
	}
	if got := store.auctions[auction.ID].CurrentBidder; got != "Nighthawk" {
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
