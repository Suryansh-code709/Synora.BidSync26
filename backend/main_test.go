package main

import "testing"

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
	result, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user2", Amount: 26000, IdempotencyKey: "valid-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected valid bid acceptance, got %+v", result)
	}
	if result.CurrentBid != 26000 {
		t.Fatalf("expected current bid to be 26000, got %d", result.CurrentBid)
	}
}

func TestStoreIdempotencyIsStable(t *testing.T) {
	store := newStore()
	first, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user3", Amount: 27000, IdempotencyKey: "dup-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	second, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user4", Amount: 28000, IdempotencyKey: "dup-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if first.BidID != second.BidID {
		t.Fatalf("expected same bid id for idempotent request, got %d and %d", first.BidID, second.BidID)
	}
	if second.CurrentBid != 27000 {
		t.Fatalf("expected idempotent request to return original result, got %d", second.CurrentBid)
	}
}

func TestStoreUsesRequestedAuctionID(t *testing.T) {
	store := newStore()
	result, err := store.placeBid(BidRequest{AuctionID: 2, Bidder: "user4", Amount: 19000, IdempotencyKey: "auction-2-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Accepted {
		t.Fatalf("expected bid on auction 2 to be accepted, got %+v", result)
	}
	if result.AuctionID != 2 {
		t.Fatalf("expected response to target auction 2, got %d", result.AuctionID)
	}
	if auction, ok := store.auctions[2]; !ok || auction.CurrentBid != 19000 {
		t.Fatalf("expected auction 2 current bid to update to 19000, got %+v", store.auctions[2])
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
	if auction.ID != 4 || auction.CurrentBid != 50000 || auction.Status != AuctionStatusActive {
		t.Fatalf("unexpected created auction: %+v", auction)
	}
}

func TestStoreDeletesAuctionWithoutBids(t *testing.T) {
	store := newStore()
	auction, err := store.createAuction(CreateAuctionRequest{Title: "Delete me", Category: "Test", StartingPrice: 1000, DurationHours: 1})
	if err != nil {
		t.Fatalf("unexpected error creating auction: %v", err)
	}
	if err := store.deleteAuction(auction.ID); err != nil {
		t.Fatalf("unexpected delete error: %v", err)
	}
	if _, ok := store.getAuction(auction.ID); ok {
		t.Fatalf("expected auction %d to be deleted", auction.ID)
	}
}

func TestStoreDeletesAuctionWithBids(t *testing.T) {
	store := newStore()
	if _, err := store.placeBid(BidRequest{AuctionID: 1, Bidder: "user1", Amount: 26000, IdempotencyKey: "delete-protection"}); err != nil {
		t.Fatalf("unexpected bid error: %v", err)
	}
	if err := store.deleteAuction(1); err != nil {
		t.Fatalf("expected auction with bids to be deleted: %v", err)
	}
	if _, ok := store.getAuction(1); ok {
		t.Fatalf("expected auction 1 to be deleted")
	}
}
