package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

type AuctionStatus string

const (
	AuctionStatusUpcoming AuctionStatus = "upcoming"
	AuctionStatusActive   AuctionStatus = "active"
	AuctionStatusEnded    AuctionStatus = "ended"
)

type Auction struct {
	ID            int           `json:"id"`
	Title         string        `json:"title"`
	Description   string        `json:"description"`
	Category      string        `json:"category"`
	ImageURL      string        `json:"image_url"`
	StartingPrice int64         `json:"starting_price"`
	CurrentBid    int64         `json:"current_bid"`
	CurrentBidder string        `json:"current_bidder,omitempty"`
	Status        AuctionStatus `json:"status"`
	StartsAt      time.Time     `json:"starts_at"`
	EndsAt        time.Time     `json:"ends_at"`
	Version       int64         `json:"version"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
	BidCount      int           `json:"bid_count"`
}

type Bid struct {
	ID        int64     `json:"id"`
	AuctionID int       `json:"auction_id"`
	Bidder    string    `json:"bidder"`
	Amount    int64     `json:"amount"`
	CreatedAt time.Time `json:"created_at"`
}

type BidRequest struct {
	AuctionID      int    `json:"auction_id"`
	Bidder         string `json:"bidder"`
	BidderAlias    string `json:"bidder_alias"`
	Amount         int64  `json:"amount"`
	IdempotencyKey string `json:"idempotency_key"`
	WalletAddress  string `json:"wallet_address"`
	WalletNetwork  string `json:"wallet_network"`
	Signature      string `json:"signature"`
}

type CreateAuctionRequest struct {
	Title           string `json:"title"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	ImageURL        string `json:"image_url"`
	StartingPrice   int64  `json:"starting_price"`
	DurationMinutes int    `json:"duration_minutes"`
	DurationHours   int    `json:"duration_hours"`
}

type Acknowledge struct {
	Accepted      bool   `json:"accepted"`
	Message       string `json:"message"`
	Idempotent    bool   `json:"idempotent,omitempty"`
	CurrentBid    int64  `json:"current_bid,omitempty"`
	MinimumNext   int64  `json:"minimum_next_bid,omitempty"`
	BidID         int64  `json:"bid_id,omitempty"`
	AuctionID     int    `json:"auction_id"`
	AuctionStatus string `json:"auction_status,omitempty"`
}

type Event struct {
	Type      string `json:"type"`
	AuctionID int    `json:"auction_id"`
	Payload   any    `json:"payload"`
}

type Store struct {
	mu          sync.Mutex
	auctions    map[int]*Auction
	bids        []Bid
	clients     map[chan string]struct{}
	idempotency map[string]Acknowledge
	nextBidID   int64
	requests    int64
	rejected    int64
	requestLog  []time.Time
	bidLog      []time.Time
}

func newStore() *Store {
	base := time.Now().UTC()
	auctions := map[int]*Auction{
		1: {
			ID:            1,
			Title:         "The Grand St. Petersburg View",
			Description:   "A rare 19th-century European landscape painting with layered atmospheric depth and gilt frame provenance.",
			Category:      "Antique Paintings",
			ImageURL:      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=1200&q=80",
			StartingPrice: 85000,
			CurrentBid:    85000,
			Status:        AuctionStatusActive,
			StartsAt:      base.Add(-25 * time.Minute),
			EndsAt:        base.Add(35 * time.Minute),
			Version:       0,
			CreatedAt:     base.Add(-2 * time.Hour),
			UpdatedAt:     base,
		},
		2: {
			ID:            2,
			Title:         "Bronze Imperial Muse",
			Description:   "A finely cast antique sculpture with a rich patina, museum-quality restoration, and collector appeal.",
			Category:      "Antique Sculptures",
			ImageURL:      "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=80",
			StartingPrice: 120000,
			CurrentBid:    120000,
			Status:        AuctionStatusActive,
			StartsAt:      base.Add(-18 * time.Minute),
			EndsAt:        base.Add(42 * time.Minute),
			Version:       0,
			CreatedAt:     base.Add(-3 * time.Hour),
			UpdatedAt:     base,
		},
		3: {
			ID:            3,
			Title:         "Emerald & Pearl Heirloom Necklace",
			Description:   "An exquisite antique jewelry piece featuring handcrafted stonework, delicate filigree, and heritage finish.",
			Category:      "Jewelry",
			ImageURL:      "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1200&q=80",
			StartingPrice: 96000,
			CurrentBid:    96000,
			Status:        AuctionStatusActive,
			StartsAt:      base.Add(-40 * time.Minute),
			EndsAt:        base.Add(28 * time.Minute),
			Version:       0,
			CreatedAt:     base.Add(-4 * time.Hour),
			UpdatedAt:     base,
		},
	}
	return &Store{
		auctions:    auctions,
		bids:        []Bid{},
		clients:     map[chan string]struct{}{},
		idempotency: map[string]Acknowledge{},
	}
}

func (s *Store) minimumNextBid(current int64) int64 {
	if current <= 0 {
		return 1000
	}
	return current + 1000
}

func (s *Store) trackRequest(now time.Time) {
	cutoff := now.Add(-time.Minute)
	filtered := s.requestLog[:0]
	for _, ts := range s.requestLog {
		if ts.After(cutoff) || ts.Equal(cutoff) {
			filtered = append(filtered, ts)
		}
	}
	s.requestLog = append(filtered, now)
}

func (s *Store) trackBid(now time.Time) {
	cutoff := now.Add(-time.Minute)
	filtered := s.bidLog[:0]
	for _, ts := range s.bidLog {
		if ts.After(cutoff) || ts.Equal(cutoff) {
			filtered = append(filtered, ts)
		}
	}
	s.bidLog = append(filtered, now)
}

func (s *Store) listAuctions() []Auction {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	s.requests++
	s.trackRequest(now)
	out := make([]Auction, 0, len(s.auctions))
	for _, a := range s.auctions {
		updated := normalizeAuctionStatus(a)
		out = append(out, cloneAuction(*updated))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].EndsAt.Before(out[j].EndsAt) })
	return out
}

func normalizeAuctionStatus(a *Auction) *Auction {
	if a == nil {
		return &Auction{}
	}
	if time.Now().UTC().After(a.EndsAt) {
		a.Status = AuctionStatusEnded
		return a
	}
	if time.Now().UTC().Before(a.StartsAt) {
		a.Status = AuctionStatusUpcoming
		return a
	}
	a.Status = AuctionStatusActive
	return a
}

func (s *Store) getAuction(id int) (Auction, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests++
	s.trackRequest(time.Now().UTC())
	a, ok := s.auctions[id]
	if !ok {
		return Auction{}, false
	}
	updated := normalizeAuctionStatus(a)
	return cloneAuction(*updated), true
}

func (s *Store) createAuction(req CreateAuctionRequest) (Auction, error) {
	if strings.TrimSpace(req.Title) == "" {
		return Auction{}, errors.New("title required")
	}
	if strings.TrimSpace(req.Category) == "" {
		return Auction{}, errors.New("category required")
	}
	if req.StartingPrice <= 0 {
		return Auction{}, errors.New("starting price must be positive")
	}

	durationMinutes := req.DurationMinutes
	if durationMinutes <= 0 && req.DurationHours > 0 {
		durationMinutes = req.DurationHours * 60
	}
	if durationMinutes < 10 || durationMinutes > 7*24*60 {
		return Auction{}, errors.New("duration must be at least 10 minutes and no more than 7 days")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.requests++
	s.trackRequest(now)

	nextID := 1
	for id := range s.auctions {
		if id >= nextID {
			nextID = id + 1
		}
	}
	launchAt := now.Add(5 * time.Second)
	imageURL := strings.TrimSpace(req.ImageURL)
	auction := Auction{
		ID:            nextID,
		Title:         strings.TrimSpace(req.Title),
		Description:   strings.TrimSpace(req.Description),
		Category:      strings.TrimSpace(req.Category),
		ImageURL:      imageURL,
		StartingPrice: req.StartingPrice,
		CurrentBid:    req.StartingPrice,
		Status:        AuctionStatusUpcoming,
		StartsAt:      launchAt,
		EndsAt:        launchAt.Add(time.Duration(durationMinutes) * time.Minute),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	s.auctions[nextID] = &auction
	log.Printf("[auction] created id=%d title=%q category=%q starts_at=%s ends_at=%s", auction.ID, auction.Title, auction.Category, auction.StartsAt.Format(time.RFC3339), auction.EndsAt.Format(time.RFC3339))
	s.emitEvent(Event{Type: "auction_created", AuctionID: nextID, Payload: map[string]any{"auction": auction}})
	return cloneAuction(auction), nil
}

func (s *Store) deleteAuction(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, ok := s.auctions[id]
	if !ok {
		return errors.New("auction not found")
	}
	delete(s.auctions, id)
	remainingBids := s.bids[:0]
	for _, bid := range s.bids {
		if bid.AuctionID != id {
			remainingBids = append(remainingBids, bid)
		}
	}
	s.bids = remainingBids
	s.emitEvent(Event{Type: "auction_deleted", AuctionID: id, Payload: map[string]any{"auction_id": id}})
	return nil
}

func cloneAuction(a Auction) Auction {
	copyA := a
	return copyA
}

func normalizeWalletAddress(address string) string {
	cleaned := strings.TrimSpace(address)
	if cleaned == "" {
		return ""
	}
	if strings.HasPrefix(cleaned, "0x") || strings.HasPrefix(cleaned, "0X") {
		return strings.ToLower(cleaned)
	}
	return strings.ToLower("0x" + cleaned)
}

func maskWalletAddress(address string) string {
	cleaned := normalizeWalletAddress(address)
	if cleaned == "" {
		return "Anonymous bidder"
	}
	if len(cleaned) <= 10 {
		return cleaned
	}
	return cleaned[:6] + "..." + cleaned[len(cleaned)-4:]
}

func verifyWalletSignature(walletAddress string, signature string, message string) bool {
	address := normalizeWalletAddress(walletAddress)
	if address == "" || signature == "" {
		return false
	}

	sigBytes := common.FromHex(signature)
	if len(sigBytes) != 65 {
		return false
	}
	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}

	msgHash := crypto.Keccak256([]byte("\x19Ethereum Signed Message:\n" + strconv.Itoa(len(message)) + message))
	pubKey, err := crypto.SigToPub(msgHash, sigBytes)
	if err != nil || pubKey == nil {
		return false
	}

	recovered := crypto.PubkeyToAddress(*pubKey).Hex()
	return strings.EqualFold(recovered, address)
}

func (s *Store) placeBid(req BidRequest) (Acknowledge, error) {
	if req.AuctionID <= 0 {
		req.AuctionID = 1
	}
	if req.Amount <= 0 {
		return Acknowledge{}, errors.New("amount must be positive")
	}
	if trimmedAlias := strings.TrimSpace(req.BidderAlias); trimmedAlias != "" {
		req.Bidder = trimmedAlias
	}
	if req.WalletAddress != "" {
		if req.Signature == "" {
			return Acknowledge{}, errors.New("wallet signature required")
		}
		msg := fmt.Sprintf("BidSync market approval:%d:%d:%s", req.AuctionID, req.Amount, req.IdempotencyKey)
		if !verifyWalletSignature(req.WalletAddress, req.Signature, msg) {
			return Acknowledge{}, errors.New("wallet signature validation failed")
		}
		if strings.TrimSpace(req.Bidder) == "" {
			req.Bidder = maskWalletAddress(req.WalletAddress)
		}
	}
	if strings.TrimSpace(req.Bidder) == "" {
		return Acknowledge{}, errors.New("bidder required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.requests++
	s.trackRequest(now)

	if req.IdempotencyKey != "" {
		if existing, ok := s.idempotency[fmt.Sprintf("%d:%s", req.AuctionID, req.IdempotencyKey)]; ok {
			log.Printf("[bid] idempotent replay auction_id=%d bidder=%s amount=%d key=%s", req.AuctionID, req.Bidder, req.Amount, req.IdempotencyKey)
			return existing, nil
		}
		if existing, ok := s.idempotency[req.IdempotencyKey]; ok {
			log.Printf("[bid] idempotent replay auction_id=%d bidder=%s amount=%d key=%s", req.AuctionID, req.Bidder, req.Amount, req.IdempotencyKey)
			return existing, nil
		}
	}

	a, ok := s.auctions[req.AuctionID]
	if !ok {
		return Acknowledge{}, errors.New("auction not found")
	}
	a = normalizeAuctionStatus(a)
	if a.Status != AuctionStatusActive {
		s.rejected++
		log.Printf("[bid] rejected auction_id=%d reason=inactive bidder=%s amount=%d", a.ID, req.Bidder, req.Amount)
		return Acknowledge{Accepted: false, Message: "Auction is not active.", CurrentBid: a.CurrentBid, AuctionID: a.ID}, nil
	}
	if req.Amount < s.minimumNextBid(a.CurrentBid) {
		s.rejected++
		log.Printf("[bid] rejected auction_id=%d reason=too_low bidder=%s amount=%d minimum=%d", a.ID, req.Bidder, req.Amount, s.minimumNextBid(a.CurrentBid))
		return Acknowledge{Accepted: false, Message: "Bid too low.", CurrentBid: a.CurrentBid, MinimumNext: s.minimumNextBid(a.CurrentBid), AuctionID: a.ID}, nil
	}
	if time.Now().UTC().After(a.EndsAt) || a.Status == AuctionStatusEnded {
		s.rejected++
		log.Printf("[bid] rejected auction_id=%d reason=closed bidder=%s amount=%d", a.ID, req.Bidder, req.Amount)
		return Acknowledge{Accepted: false, Message: "Auction closed.", CurrentBid: a.CurrentBid, AuctionID: a.ID}, nil
	}
	s.nextBidID++
	bid := Bid{
		ID:        s.nextBidID,
		AuctionID: a.ID,
		Bidder:    req.Bidder,
		Amount:    req.Amount,
		CreatedAt: time.Now().UTC(),
	}
	s.bids = append(s.bids, bid)
	a.CurrentBid = req.Amount
	a.CurrentBidder = req.Bidder
	a.UpdatedAt = bid.CreatedAt
	a.Version++
	a.BidCount = len(s.bids)

	result := Acknowledge{
		Accepted:      true,
		Message:       "Bid accepted",
		CurrentBid:    a.CurrentBid,
		MinimumNext:   s.minimumNextBid(a.CurrentBid),
		BidID:         bid.ID,
		AuctionID:     a.ID,
		AuctionStatus: string(a.Status),
	}
	if req.IdempotencyKey != "" {
		s.idempotency[fmt.Sprintf("%d:%s", req.AuctionID, req.IdempotencyKey)] = result
		s.idempotency[req.IdempotencyKey] = result
	}
	s.trackBid(time.Now().UTC())
	log.Printf("[bid] accepted auction_id=%d bidder=%s amount=%d total_bids=%d current_bid=%d", a.ID, req.Bidder, req.Amount, len(s.bids), a.CurrentBid)
	payload := map[string]any{
		"auction": a,
		"bid":     bid,
		"result":  result,
	}
	s.emitEvent(Event{Type: "bid_accepted", AuctionID: a.ID, Payload: payload})
	return result, nil
}

func (s *Store) emitEvent(evt Event) {
	payload, err := json.Marshal(evt)
	if err != nil {
		return
	}
	msg := string(payload)
	for ch := range s.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (s *Store) subscribe() chan string {
	ch := make(chan string, 20)
	s.mu.Lock()
	s.clients[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func (s *Store) unsubscribe(ch chan string) {
	s.mu.Lock()
	delete(s.clients, ch)
	s.mu.Unlock()
	close(ch)
}

func (s *Store) getMetrics() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var totalAmount int64
	for _, bid := range s.bids {
		totalAmount += bid.Amount
	}
	averageBid := int64(0)
	if len(s.bids) > 0 {
		averageBid = totalAmount / int64(len(s.bids))
	}

	requestRate := 0.0
	if len(s.requestLog) > 0 {
		requestRate = float64(len(s.requestLog)) / 60.0
	}
	bidRate := 0.0
	if len(s.bidLog) > 0 {
		bidRate = float64(len(s.bidLog)) / 60.0
	}

	return map[string]any{
		"active_auctions":     len(s.auctions),
		"total_requests":      s.requests,
		"total_bids":          len(s.bids),
		"successful_bids":     len(s.bids),
		"rejected_bids":       s.rejected,
		"average_bid":         averageBid,
		"connections":         len(s.clients),
		"requests_per_second": fmt.Sprintf("%.2f", requestRate),
		"bids_per_second":     fmt.Sprintf("%.2f", bidRate),
		"load_index":          fmt.Sprintf("%.0f", min(100.0, requestRate*10.0+float64(len(s.clients))*2.5)),
		"last_updated":        time.Now().UTC().Format(time.RFC3339),
	}
}

func (s *Store) auctionByID(id int) (*Auction, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.auctions[id]
	if !ok {
		return nil, false
	}
	return a, true
}

func main() {
	store := newStore()
	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "auction-backend"})
	})

	mux.HandleFunc("/api/auctions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodPost {
			var req CreateAuctionRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
				return
			}
			auction, err := store.createAuction(req)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(auction)
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		json.NewEncoder(w).Encode(store.listAuctions())
	})

	mux.HandleFunc("/api/auctions/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		path := strings.TrimPrefix(r.URL.Path, "/api/auctions/")
		idStr := strings.TrimSuffix(path, "/bids")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodGet {
			auction, ok := store.getAuction(id)
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(auction)
			return
		}
		if r.Method == http.MethodDelete {
			if err := store.deleteAuction(id); err != nil {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPost {
			if !strings.HasSuffix(r.URL.Path, "/bids") {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			auctionID, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/auctions/"), "/bids"))
			if err != nil || auctionID <= 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid auction id"})
				return
			}
			var req BidRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
				return
			}
			req.AuctionID = auctionID
			if req.IdempotencyKey == "" {
				req.IdempotencyKey = r.Header.Get("Idempotency-Key")
			}
			if req.IdempotencyKey == "" {
				req.IdempotencyKey = r.Header.Get("X-Idempotency-Key")
			}
			result, err := store.placeBid(req)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if !result.Accepted {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			json.NewEncoder(w).Encode(result)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/stream", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		flusher, ok := w.(http.Flusher)
		if !ok {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		ch := store.subscribe()
		defer store.unsubscribe(ch)
		for {
			select {
			case msg := <-ch:
				fmt.Fprintf(w, "data: %s\n\n", msg)
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	mux.HandleFunc("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(store.getMetrics())
	})

	mux.HandleFunc("/api/demo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(map[string]any{
			"message": "demo mode active",
			"system":  "auction-platform",
			"servers": []string{"api", "bid-service", "realtime-gateway"},
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
