CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auctions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  starting_price BIGINT NOT NULL,
  current_bid BIGINT NOT NULL,
  current_bidder TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'ended', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bids (
  id BIGSERIAL PRIMARY KEY,
  auction_id INT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder TEXT NOT NULL,
  amount BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bids_auction_created ON bids (auction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auctions_status_ends ON auctions (status, ends_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  auction_id INT NOT NULL REFERENCES auctions(id),
  bid_id BIGINT REFERENCES bids(id),
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id BIGINT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (email, display_name, password_hash, role)
VALUES
  ('demo@auction.local', 'Demo Bidder', 'demo_hash', 'user'),
  ('admin@auction.local', 'Admin User', 'admin_hash', 'admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO auctions (
  title, description, category, image_url, starting_price, current_bid, current_bidder, status, starts_at, ends_at
) VALUES
  ('Apex Racing Bike', 'Performance road bike with carbon frame and electronic shifting.', 'Cycling', 'https://images.unsplash.com/...', 25000, 25000, NULL, 'active', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '20 minutes'),
  ('Luma Smartwatch', 'Premium smartwatch with AMOLED display and 7-day battery life.', 'Electronics', 'https://images.unsplash.com/...', 18000, 18000, NULL, 'active', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '40 minutes'),
  ('Summit Camera', 'Full-frame mirrorless camera built for creators.', 'Photography', 'https://images.unsplash.com/...', 44000, 44000, NULL, 'upcoming', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '5 hours')
ON CONFLICT DO NOTHING;
