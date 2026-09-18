# BidSync

BidSync is a market-ready anonymous auction platform for premium collectibles, antiques, and luxury inventory. The marketplace is designed for wallet-backed participation: buyers connect a Polygon wallet, sign a challenge message to verify ownership, and submit bids without exposing their public identity. The UI masks wallet addresses while still validating each bid cryptographically.

## Summary

This project combines a Go API, a React + Next.js frontend, PostgreSQL persistence, and Docker-based infrastructure to deliver a secure auction marketplace. It focuses on real-time bidding, wallet verification, anonymous bidder identity, idempotent bid acceptance, and a polished user experience.

## Architecture

- Frontend: Next.js + React + TypeScript + Tailwind
- Backend: Go HTTP API with auction validation, wallet signature verification, and SSE streaming
- Wallet layer: Polygon wallet connection via MetaMask or an EIP-1193-compatible provider
- Identity model: anonymous bidding using masked wallet addresses while preserving verifiable signatures
- Data: PostgreSQL schema for auctions, bids, idempotency keys, and audit data
- Runtime: Docker Compose with Postgres, Redis, NGINX, and the backend services

## Core auction logic

The backend validates bids under a single-writer lock, checks auction status, enforces minimum increments, rejects expired or invalid auctions, and accepts only one logical bid per idempotency key. If a wallet signature is supplied, the backend verifies that it matches the claiming wallet before the bid is accepted.

## Real-time behavior

Successful bids trigger a server-sent events update so all connected clients receive the latest price, bidding activity, and order changes without reloading the page.

## Idempotency

Every bid request can include an `Idempotency-Key` header or field. Repeating the same request returns the same result instead of creating duplicate logical bids.

## Wallet flow

1. User connects a Polygon wallet.
2. User signs a market-specific message generated for the auction and bid amount.
3. Backend verifies the signature against the wallet address.
4. Bid is accepted only if the signature matches and the auction rules are satisfied.
5. Public UI shows a masked wallet label to keep the bidder anonymous.

## Local setup

1. Start the required infrastructure:
   `docker compose up -d postgres redis`
2. Start the backend:
   `cd backend && go run .`
3. Start the frontend:
   `cd frontend && npm install && npm run dev`
4. Open the app at `http://localhost:3000`

## API endpoints

- `GET /api/health`
- `GET /api/auctions`
- `GET /api/auctions/:id`
- `POST /api/auctions/:id/bids`
- `GET /api/metrics`
- `GET /api/stream`

## Production notes

This project is intentionally built to feel like a real marketplace rather than a hackathon demo. The flow is transparent, explainable, and close to a real production system while still being easy to run locally.