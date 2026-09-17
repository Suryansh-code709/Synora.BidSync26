# Synora Auction System

A competition-grade real-time bidding platform demonstrating secure transactional bidding semantics, idempotency, live updates, and observability in a simple judge-friendly architecture.

## Summary

This project simulates a distributed auction platform backed by a Go HTTP service with in-memory state for demo readiness. It focuses on the critical backend correctness constraints required by a real bidding system: serializing bid acceptance, preventing duplicate logical bids, rejecting stale or invalid bids, and surfacing a clear real-time state to clients.

## Architecture

- Frontend: Next.js + React + TypeScript + Tailwind UI
- Backend: Go HTTP API with transactional-style bid validation and SSE streaming
- State: In-memory store for demo-ready concurrency simulation and event delivery
- Database: PostgreSQL schema prepared for production extension
- Messaging: Redis-ready event model with outbox-style event emission in the backend
- Monitoring: `/api/metrics` endpoint and live demo cards

## Core transaction strategy

The backend bid pipeline follows a single-writer validation model: it locks the auction state, checks validity, verifies the required minimum increment, rejects expired or inactive auctions, and accepts only one logical bid per idempotency key before emitting the success event. This preserves correctness under concurrent attempts while keeping the system explainable in a live demo.

## Real-time behavior

Successful bids trigger event emission to connected SSE clients. All connected clients receive a `bid_accepted` message to update the live price, count, and activity immediately without a page reload.

## Idempotency

Every bid request may include an `Idempotency-Key` header or field. A repeating request with the same key repeats the prior result instead of creating duplicate logical bids.

## Data model

The included SQL schema in `database/migrations/001_init.sql` defines the core tables for users, auctions, bids, idempotency keys, outbox events, and audit logs.

## Running locally

1. Copy `.env.example` to `.env` or use the provided values.
2. Start Postgres and Redis with Docker Compose:
   `docker compose up -d postgres redis`
3. Start the backend:
   `cd backend && go run .`
4. Start the frontend:
   `cd frontend && npm install && npm run dev`
5. Open the app at `http://localhost:3000`.

## API endpoints

- `GET /api/health`
- `GET /api/auctions`
- `GET /api/auctions/:id`
- `POST /api/auctions/:id/bids`
- `GET /api/metrics`
- `GET /api/stream`

## Demo flow

1. Open the market page.
2. Watch the live auction cards update in real time.
3. Place a bid using a custom amount or quick bid buttons.
4. Observe the immediate status message and SSE stream updates.
5. Repeat the same request with the same idempotency key to confirm duplicate protection.

## Testing

Run:

- `cd backend && go test ./...`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

### 5,000 virtual bidder demo

Install k6, keep the backend running, then run:

`k6 run load-tests/auction-load.js`

The scenario ramps to 5,000 virtual users. These are simulated API clients, not 5,000 physical browser users. During the run, open `/api/metrics` or the frontend metrics cards to show measured request and bid volume.

To test the deployed backend, set its URL:

`k6 run -e BASE_URL=https://your-backend.onrender.com load-tests/auction-load.js`

For the complete judge demonstration, run the combined bidder and observer scenario:

`k6 run -e BASE_URL=https://your-backend.onrender.com load-tests/judge-demo.js`

This runs 5,000 virtual bidding clients and two observer clients at the same time. Separately open the frontend in two browser tabs, select the same auction, and place a bid in one tab. Both real tabs should update through SSE while k6 drives the backend traffic.

## Notes

This implementation is designed to be transparent and demo-friendly while still reflecting production-grade auction semantics. The backend is intentionally simple to reason about and extend, and the PostgreSQL schema provides the foundation for a fuller production deployment.
