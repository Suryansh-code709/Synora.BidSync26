import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '30s', target: 500 },
    { duration: '60s', target: 2000 },
    { duration: '60s', target: 5000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(`${BASE_URL}/api/auctions/1/bids`, JSON.stringify({
    bidder: `user-${__VU}-${__ITER}`,
    amount: 60000,
    idempotency_key: `load-${__VU}-${__ITER}-${Date.now()}`,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 2xx or 422': (r) => r.status === 200 || r.status === 422,
  });

  sleep(0.1);
}
