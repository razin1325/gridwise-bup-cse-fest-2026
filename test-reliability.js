const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function testCrashResilience() {
  console.log('=== Starting Crash & Edge Case Resilience Test ===\n');

  const testCases = [
    {
      name: 'Malformed JSON Body',
      rawBody: '{ "scenario_id": "test_bad_json", ',
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Empty Body',
      rawBody: '',
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Missing scenario_id',
      rawBody: JSON.stringify({
        battery: { capacity_kwh: 100, initial_energy_kwh: 20, max_charge_kwh_per_hour: 20, max_discharge_kwh_per_hour: 20, minimum_energy_kwh: 10 },
        operator_notes: [],
        hours: []
      }),
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Missing operator_notes',
      rawBody: JSON.stringify({
        scenario_id: 'test_missing_notes',
        battery: { capacity_kwh: 100, initial_energy_kwh: 20, max_charge_kwh_per_hour: 20, max_discharge_kwh_per_hour: 20, minimum_energy_kwh: 10 },
        hours: Array(24).fill(0).map((_, i) => ({ hour: i, demand_kwh: 10, solar_kwh: 5, tariff_bdt_per_kwh: 6 }))
      }),
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Invalid hours array length (12 hours instead of 24)',
      rawBody: JSON.stringify({
        scenario_id: 'test_12_hours',
        battery: { capacity_kwh: 100, initial_energy_kwh: 20, max_charge_kwh_per_hour: 20, max_discharge_kwh_per_hour: 20, minimum_energy_kwh: 10 },
        operator_notes: [],
        hours: Array(12).fill(0).map((_, i) => ({ hour: i, demand_kwh: 10, solar_kwh: 5, tariff_bdt_per_kwh: 6 }))
      }),
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Null operator_notes element',
      rawBody: JSON.stringify({
        scenario_id: 'test_null_note',
        battery: { capacity_kwh: 100, initial_energy_kwh: 20, max_charge_kwh_per_hour: 20, max_discharge_kwh_per_hour: 20, minimum_energy_kwh: 10 },
        operator_notes: [null],
        hours: Array(24).fill(0).map((_, i) => ({ hour: i, demand_kwh: 10, solar_kwh: 5, tariff_bdt_per_kwh: 6 }))
      }),
      contentType: 'application/json',
      expectedStatus: 400
    },
    {
      name: 'Infeasible LP (impossible battery reserve > capacity)',
      rawBody: JSON.stringify({
        scenario_id: 'test_infeasible',
        battery: { capacity_kwh: 100, initial_energy_kwh: 20, max_charge_kwh_per_hour: 20, max_discharge_kwh_per_hour: 20, minimum_energy_kwh: 150 }, // min reserve > capacity
        operator_notes: ['Normal operational note'],
        hours: Array(24).fill(0).map((_, i) => ({ hour: i, demand_kwh: 10, solar_kwh: 5, tariff_bdt_per_kwh: 6 }))
      }),
      contentType: 'application/json',
      expectedStatus: 500
    }
  ];

  let passed = 0;
  for (const tc of testCases) {
    try {
      const res = await fetch(`${BASE_URL}/api/optimize-energy`, {
        method: 'POST',
        headers: { 'Content-Type': tc.contentType },
        body: tc.rawBody
      });
      const data = await res.json().catch(() => null);
      if (res.status === tc.expectedStatus) {
        console.log(`[PASS] ${tc.name} -> HTTP ${res.status} (as expected)`);
        passed++;
      } else {
        console.log(`[FAIL] ${tc.name} -> Got HTTP ${res.status}, expected ${tc.expectedStatus}. Response:`, data);
      }
    } catch (err) {
      console.log(`[ERROR] ${tc.name} -> Exception: ${err.message}`);
    }
  }

  console.log(`\nCrash Test Result: ${passed}/${testCases.length} edge cases handled cleanly.`);
}

async function testParallelStressAndP95() {
  console.log('\n=== Starting Stress Test & Multi-run p95 Latency Check ===\n');
  const samplePath = path.join(__dirname, 'BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json');
  if (!fs.existsSync(samplePath)) {
    console.error('Sample case file not found');
    return;
  }
  const cases = JSON.parse(fs.readFileSync(samplePath, 'utf8')).cases || [];

  // Run 3 full iterations (30 total API calls) sequentially & concurrently to collect latency data
  const latencies = [];
  let totalRequests = 0;
  let successfulRequests = 0;

  console.log('Sending 30 requests (3 rounds of 10 sample cases)...');
  for (let round = 1; round <= 3; round++) {
    const roundPromises = cases.map(async (testCase) => {
      const start = Date.now();
      totalRequests++;
      try {
        const res = await fetch(`${BASE_URL}/api/optimize-energy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.input)
        });
        const duration = Date.now() - start;
        if (res.status === 200) {
          latencies.push(duration);
          successfulRequests++;
        }
      } catch (err) {
        console.error(`Request failed during stress round ${round}: ${err.message}`);
      }
    });
    await Promise.all(roundPromises);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] || 0;
  const p99 = latencies[Math.ceil(latencies.length * 0.99) - 1] || 0;
  const min = latencies[0] || 0;
  const max = latencies[latencies.length - 1] || 0;
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log(`\n--- Stress Test Statistics ---`);
  console.log(`Total Requests Sent : ${totalRequests}`);
  console.log(`Successful (HTTP 200): ${successfulRequests}`);
  console.log(`Crashes/Failures    : ${totalRequests - successfulRequests}`);
  console.log(`Minimum Latency     : ${min} ms`);
  console.log(`Average Latency     : ${avg} ms`);
  console.log(`p50 (Median)        : ${p50} ms`);
  console.log(`p95 Latency         : ${p95} ms (Target: <= 5000 ms)`);
  console.log(`p99 Latency         : ${p99} ms`);
  console.log(`Maximum Latency     : ${max} ms`);

  if (p95 <= 5000 && totalRequests === successfulRequests) {
    console.log('\n>>> SUCCESS: API meets p95 <= 5s criterion with 0 crashes! <<<');
  } else {
    console.log('\n>>> WARNING: Performance or stability criteria not met. <<<');
  }
}

async function runAll() {
  await testCrashResilience();
  await testParallelStressAndP95();
}

runAll();
