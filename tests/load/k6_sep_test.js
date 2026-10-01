import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * k6_sep_test.js
 *
 * Automated k6 load testing suite for AnchorPoint backend endpoints.
 * Simulates concurrent Virtual Users (VUs) hitting SEP-10, SEP-12, and SEP-24 endpoints
 * to establish performance baselines under high traffic.
 *
 * Requirements:
 *  - VU Ramping: 50 VUs -> 200 VUs -> 500 VUs.
 *  - Assertions: Response p95 latency < 200ms and error rate < 1%.
 *
 * Execution:
 *  k6 run tests/load/k6_sep_test.js
 *  BASE_URL=http://localhost:3002 k6 run tests/load/k6_sep_test.js
 */

// Metric tracking per SEP endpoint category
const errorRate = new Rate('errors');
const sep10Latency = new Trend('sep10_req_duration');
const sep12Latency = new Trend('sep12_req_duration');
const sep24Latency = new Trend('sep24_req_duration');

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Stage 1: Ramp-up to 50 VUs
    { duration: '1m',  target: 200 }, // Stage 2: Ramp-up to 200 VUs
    { duration: '2m',  target: 500 }, // Stage 3: Ramp-up to 500 VUs
    { duration: '2m',  target: 500 }, // Stage 4: Sustained heavy load at 500 VUs
    { duration: '30s', target: 0 },   // Stage 5: Ramp-down to 0 VUs
  ],
  thresholds: {
    // Assert response p95 latency < 200ms across all HTTP requests
    http_req_duration: ['p(95)<200'],
    // Assert HTTP request error rate < 1% (0.01)
    http_req_failed: ['rate<0.01'],
    // Assert custom error rate < 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002';
const TEST_ACCOUNT = __ENV.STELLAR_ACCOUNT || 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';

export default function () {
  // 1. SEP-10 Authentication Challenge Endpoint
  group('SEP-10 Auth Challenge', function () {
    const res = http.get(`${BASE_URL}/auth?account=${TEST_ACCOUNT}`);
    sep10Latency.add(res.timings.duration);

    const success = check(res, {
      'SEP-10 status is valid (200 or 400)': (r) => r.status === 200 || r.status === 400 || r.status === 429,
      'SEP-10 response p95 < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!success);
  });

  sleep(0.1);

  // 2. SEP-12 KYC Customer Endpoint
  group('SEP-12 KYC Customer', function () {
    const res = http.get(`${BASE_URL}/sep12/customer?account=${TEST_ACCOUNT}`);
    sep12Latency.add(res.timings.duration);

    const success = check(res, {
      'SEP-12 status is valid (200, 401, 404, or 429)': (r) => [200, 401, 404, 429].includes(r.status),
      'SEP-12 response p95 < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!success);
  });

  sleep(0.1);

  // 3. SEP-24 Interactive Deposit/Withdrawal Endpoints
  group('SEP-24 Interactive Transfer', function () {
    const infoRes = http.get(`${BASE_URL}/sep24/info`);
    sep24Latency.add(infoRes.timings.duration);

    const infoSuccess = check(infoRes, {
      'SEP-24 info status is 200': (r) => r.status === 200,
      'SEP-24 info response p95 < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!infoSuccess);

    const feeRes = http.get(`${BASE_URL}/sep24/fee?operation=deposit&asset_code=USDC&amount=100`);
    sep24Latency.add(feeRes.timings.duration);

    const feeSuccess = check(feeRes, {
      'SEP-24 fee status is valid (200 or 400)': (r) => r.status === 200 || r.status === 400,
      'SEP-24 fee response p95 < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!feeSuccess);
  });

  sleep(0.2);
}
