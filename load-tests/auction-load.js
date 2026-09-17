import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '20s', target: 50 },
    { duration: '20s', target: 100 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post('http://localhost:8080/api/auctions/1/bids', JSON.stringify({
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
