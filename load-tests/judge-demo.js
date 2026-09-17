import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    virtual_bidders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '60s', target: 2000 },
        { duration: '60s', target: 5000 },
        { duration: '30s', target: 0 },
      ],
      exec: 'placeBid',
      gracefulRampDown: '10s',
    },
    observer_tabs: {
      executor: 'constant-vus',
      vus: 2,
      duration: '3m30s',
      exec: 'observeAuction',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function placeBid() {
  const response = http.post(`${BASE_URL}/api/auctions/1/bids`, JSON.stringify({
    bidder: `virtual-user-${__VU}-${__ITER}`,
    amount: 60000,
    idempotency_key: `load-${__VU}-${__ITER}-${Date.now()}`,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(response, {
    'bid response is accepted or rejected by rules': (res) => res.status === 200 || res.status === 422,
  });
  sleep(0.1);
}

export function observeAuction() {
  const auctionResponse = http.get(`${BASE_URL}/api/auctions/1`);
  const metricsResponse = http.get(`${BASE_URL}/api/metrics`);
  check(auctionResponse, { 'observer receives auction state': (res) => res.status === 200 });
  check(metricsResponse, { 'observer receives metrics': (res) => res.status === 200 });
  sleep(1);
}
