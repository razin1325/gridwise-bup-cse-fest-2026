/*
 * GridWise public-sample validator.
 *
 * Starts no server of its own: point it at a running instance and it replays
 * every public sample case exactly the way the judge does.
 *
 *   npm start                                        # terminal 1
 *   npm run test:samples                             # terminal 2 (default http://localhost:3000)
 *   npm run test:samples -- http://localhost:3100    # custom base URL
 *
 * Checks per case:
 *   - GET /health returns {"status":"ok"}
 *   - response schema: one directive_interpretation entry per note, in note_index order
 *   - directive semantics: no_op <=> applies=false, exact structured_adjustment shape
 *   - directive application: effective solar, reserve, no-charge, no-discharge, grid cap
 *   - energy balance, battery transitions/bounds/rate limits, end-of-day neutrality
 *   - total_grid_kwh / total_cost_bdt / peak_grid_kwh recomputed from hourly_plan
 *   - cost quality ratio against the published optimal reference cost
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOL = 0.01;

const REQUIRED_ADJUSTMENT_FIELDS = {
  solar_reduction: ['factor'],
  minimum_battery_reserve: ['minimum_energy_kwh'],
  no_charge_window: [],
  no_discharge_window: [],
  max_grid_window: ['max_grid_kwh'],
};

const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateCase(input, resp) {
  const errors = [];

  if (resp.scenario_id !== input.scenario_id) {
    errors.push(`scenario_id not echoed (got ${JSON.stringify(resp.scenario_id)})`);
  }

  // ---- directive_interpretation ----
  const directives = Array.isArray(resp.directive_interpretation) ? resp.directive_interpretation : [];
  if (directives.length !== input.operator_notes.length) {
    errors.push(`expected ${input.operator_notes.length} directive entries, got ${directives.length}`);
  }
  directives.forEach((d, i) => {
    if (d.note_index !== i) errors.push(`entry ${i}: note_index is ${d.note_index}`);
    if (typeof d.explanation !== 'string' || !d.explanation.trim()) errors.push(`entry ${i}: explanation missing`);

    if (d.applies === false) {
      if (d.directive_type !== 'no_op') errors.push(`entry ${i}: applies=false must use no_op`);
      if (d.structured_adjustment !== null) errors.push(`entry ${i}: applies=false must use null structured_adjustment`);
      return;
    }
    if (d.applies !== true) {
      errors.push(`entry ${i}: applies must be a boolean`);
      return;
    }
    if (d.directive_type === 'no_op') errors.push(`entry ${i}: applies=true with no_op`);

    const requiredFields = REQUIRED_ADJUSTMENT_FIELDS[d.directive_type];
    if (!requiredFields) {
      errors.push(`entry ${i}: unsupported directive_type ${JSON.stringify(d.directive_type)}`);
      return;
    }
    const adjustment = d.structured_adjustment;
    if (!adjustment || typeof adjustment !== 'object') {
      errors.push(`entry ${i}: structured_adjustment missing`);
      return;
    }
    const hours = adjustment.hours;
    if (!Array.isArray(hours) || hours.length === 0) {
      errors.push(`entry ${i}: hours missing or empty`);
    } else {
      if (hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) errors.push(`entry ${i}: hours must be integers 0..23`);
      if (new Set(hours).size !== hours.length) errors.push(`entry ${i}: hours contain duplicates`);
      if (JSON.stringify(hours) !== JSON.stringify([...hours].sort((a, b) => a - b))) errors.push(`entry ${i}: hours not ascending`);
    }
    for (const field of requiredFields) {
      if (!isNum(adjustment[field])) errors.push(`entry ${i}: structured_adjustment.${field} missing or not a number`);
    }
    if (d.directive_type === 'solar_reduction' && isNum(adjustment.factor) && (adjustment.factor < 0 || adjustment.factor > 1)) {
      errors.push(`entry ${i}: factor ${adjustment.factor} outside [0,1]`);
    }
  });

  // ---- effective constraints derived from the reported directives ----
  const effectiveSolar = input.hours.map((h) => h.solar_kwh);
  const activeMinimum = input.hours.map(() => input.battery.minimum_energy_kwh);
  const chargeAllowed = input.hours.map(() => true);
  const dischargeAllowed = input.hours.map(() => true);
  const gridCap = input.hours.map(() => Infinity);

  for (const d of directives) {
    if (!d.applies || !d.structured_adjustment) continue;
    const { hours = [] } = d.structured_adjustment;
    for (const h of hours) {
      if (!Number.isInteger(h) || h < 0 || h > 23) continue;
      if (d.directive_type === 'solar_reduction') effectiveSolar[h] *= d.structured_adjustment.factor;
      if (d.directive_type === 'minimum_battery_reserve') {
        activeMinimum[h] = Math.max(activeMinimum[h], d.structured_adjustment.minimum_energy_kwh);
      }
      if (d.directive_type === 'no_charge_window') chargeAllowed[h] = false;
      if (d.directive_type === 'no_discharge_window') dischargeAllowed[h] = false;
      if (d.directive_type === 'max_grid_window') gridCap[h] = Math.min(gridCap[h], d.structured_adjustment.max_grid_kwh);
    }
  }

  // ---- hourly_plan ----
  const plan = Array.isArray(resp.hourly_plan) ? resp.hourly_plan : [];
  if (plan.length !== 24) {
    errors.push(`hourly_plan must have 24 entries, got ${plan.length}`);
    return errors;
  }
  if (new Set(plan.map((p) => p.hour)).size !== 24) errors.push('hourly_plan hours are not 24 unique values');

  let totalGrid = 0;
  let totalCost = 0;
  let peakGrid = 0;
  let previousEnergy = input.battery.initial_energy_kwh;

  for (const entry of plan) {
    const h = entry.hour;
    const hourInput = input.hours[h];
    if (!hourInput) {
      errors.push(`hourly_plan references unknown hour ${h}`);
      continue;
    }
    for (const field of ['grid_kwh', 'solar_used_kwh', 'battery_kwh', 'battery_energy_after_kwh']) {
      if (!isNum(entry[field])) errors.push(`hour ${h}: ${field} is not a finite number`);
      else if (entry[field] < 0) errors.push(`hour ${h}: ${field} is negative`);
    }
    if (!['charge', 'discharge', 'idle'].includes(entry.battery_action)) {
      errors.push(`hour ${h}: invalid battery_action ${JSON.stringify(entry.battery_action)}`);
      continue;
    }

    const charge = entry.battery_action === 'charge' ? entry.battery_kwh : 0;
    const discharge = entry.battery_action === 'discharge' ? entry.battery_kwh : 0;

    const supplied = entry.grid_kwh + entry.solar_used_kwh + discharge;
    const required = hourInput.demand_kwh + charge;
    if (!near(supplied, required)) errors.push(`hour ${h}: energy balance broken (${supplied} vs ${required})`);

    if (entry.solar_used_kwh > effectiveSolar[h] + TOL) errors.push(`hour ${h}: solar_used exceeds effective solar`);
    if (entry.battery_action === 'idle' && Math.abs(entry.battery_kwh) > TOL) errors.push(`hour ${h}: idle action with battery_kwh != 0`);
    if (charge > input.battery.max_charge_kwh_per_hour + TOL) errors.push(`hour ${h}: charge exceeds max_charge_kwh_per_hour`);
    if (discharge > input.battery.max_discharge_kwh_per_hour + TOL) errors.push(`hour ${h}: discharge exceeds max_discharge_kwh_per_hour`);
    if (!chargeAllowed[h] && charge > TOL) errors.push(`hour ${h}: no_charge_window violated`);
    if (!dischargeAllowed[h] && discharge > TOL) errors.push(`hour ${h}: no_discharge_window violated`);
    if (entry.grid_kwh > gridCap[h] + TOL) errors.push(`hour ${h}: grid_kwh exceeds max_grid_window`);

    const expectedEnergy = previousEnergy + charge - discharge;
    if (!near(entry.battery_energy_after_kwh, expectedEnergy)) {
      errors.push(`hour ${h}: battery transition broken (expected ${expectedEnergy.toFixed(2)}, got ${entry.battery_energy_after_kwh})`);
    }
    if (entry.battery_energy_after_kwh < activeMinimum[h] - TOL) errors.push(`hour ${h}: below active minimum reserve (${activeMinimum[h]})`);
    if (entry.battery_energy_after_kwh > input.battery.capacity_kwh + TOL) errors.push(`hour ${h}: above battery capacity`);

    previousEnergy = entry.battery_energy_after_kwh;
    totalGrid += entry.grid_kwh;
    totalCost += entry.grid_kwh * hourInput.tariff_bdt_per_kwh;
    peakGrid = Math.max(peakGrid, entry.grid_kwh);
  }

  if (!near(previousEnergy, input.battery.initial_energy_kwh)) {
    errors.push(`end-of-day battery neutrality violated (final ${previousEnergy}, initial ${input.battery.initial_energy_kwh})`);
  }
  if (!near(resp.total_grid_kwh, totalGrid, 0.05)) errors.push(`total_grid_kwh ${resp.total_grid_kwh} != recomputed ${totalGrid.toFixed(2)}`);
  if (!near(resp.total_cost_bdt, totalCost, 0.05)) errors.push(`total_cost_bdt ${resp.total_cost_bdt} != recomputed ${totalCost.toFixed(2)}`);
  if (!near(resp.peak_grid_kwh, peakGrid, 0.05)) errors.push(`peak_grid_kwh ${resp.peak_grid_kwh} != recomputed ${peakGrid}`);
  if (typeof resp.plan_summary !== 'string' || !resp.plan_summary.trim()) errors.push('plan_summary missing');

  return errors;
}

/** Compares the reported interpretation against the published reference interpretation. */
function diffInterpretation(reference, actual) {
  const notes = [];
  const expected = reference?.directive_interpretation || [];
  expected.forEach((ref, i) => {
    const got = actual[i];
    if (!got) return;
    const sameShape =
      ref.directive_type === got.directive_type &&
      ref.applies === got.applies &&
      JSON.stringify(ref.structured_adjustment?.hours || []) === JSON.stringify(got.structured_adjustment?.hours || []);
    let sameValues = true;
    if (sameShape && ref.structured_adjustment && got.structured_adjustment) {
      for (const key of Object.keys(ref.structured_adjustment)) {
        if (key === 'hours') continue;
        if (!isNum(got.structured_adjustment[key]) || !near(ref.structured_adjustment[key], got.structured_adjustment[key], 0.011)) sameValues = false;
      }
    }
    if (!sameShape || !sameValues) {
      notes.push(
        `      note ${i}: reference ${ref.directive_type} ${JSON.stringify(ref.structured_adjustment)} | got ${got.directive_type} ${JSON.stringify(got.structured_adjustment)}`
      );
    }
  });
  return notes;
}

async function main() {
  const samplePath = path.join(__dirname, 'BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json');
  if (!fs.existsSync(samplePath)) {
    console.error(`Sample case file not found: ${samplePath}`);
    process.exit(1);
  }
  const cases = JSON.parse(fs.readFileSync(samplePath, 'utf8')).cases || [];

  console.log(`GridWise public-sample validation`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Cases:  ${cases.length}\n`);

  try {
    const healthRes = await fetch(`${BASE_URL}/health`, {
      headers: { 'bypass-tunnel-reminder': 'true' },
    });
    const healthBody = await healthRes.json().catch(() => null);
    const healthy = healthRes.status === 200 && healthBody?.status === 'ok';
    console.log(`${healthy ? 'PASS' : 'FAIL'}  GET /health -> ${healthRes.status} ${JSON.stringify(healthBody)}`);
    if (!healthy) {
      console.error('\nService is not ready; aborting.');
      process.exit(1);
    }
  } catch (error) {
    console.error(`FAIL  GET /health -> ${error.message}`);
    console.error(`\nIs the service running at ${BASE_URL}?`);
    process.exit(1);
  }

  let passed = 0;
  let totalCost = 0;
  let referenceCost = 0;
  const latencies = [];

  for (const testCase of cases) {
    const started = Date.now();
    let response;
    let status;
    try {
      const res = await fetch(`${BASE_URL}/optimize-energy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(testCase.input),
      });
      status = res.status;
      response = await res.json();
    } catch (error) {
      console.log(`FAIL  [${testCase.id}] ${testCase.label}\n      request failed: ${error.message}`);
      continue;
    }
    latencies.push(Date.now() - started);

    if (status !== 200) {
      console.log(`FAIL  [${testCase.id}] ${testCase.label}\n      HTTP ${status}: ${JSON.stringify(response).slice(0, 200)}`);
      continue;
    }

    const errors = validateCase(testCase.input, response);
    const interpretationDiffs = diffInterpretation(testCase.expected_output, response.directive_interpretation || []);
    const cost = response.total_cost_bdt;
    const optimalCost = testCase.expected_output.total_cost_bdt;
    const quality = cost > 0 ? Math.min(1, optimalCost / cost) : 1;

    totalCost += cost;
    referenceCost += optimalCost;

    if (errors.length === 0) {
      passed++;
      console.log(`PASS  [${testCase.id}] ${testCase.label}`);
      console.log(
        `      cost ${cost} BDT (reference ${optimalCost}, quality ${quality.toFixed(3)})  grid ${response.total_grid_kwh} kWh  peak ${response.peak_grid_kwh} kWh`
      );
      if (interpretationDiffs.length) {
        console.log(`      interpretation differs from reference:`);
        interpretationDiffs.forEach((line) => console.log(line));
      }
    } else {
      console.log(`FAIL  [${testCase.id}] ${testCase.label}  (${errors.length} error${errors.length === 1 ? '' : 's'})`);
      errors.slice(0, 8).forEach((e) => console.log(`      ${e}`));
      interpretationDiffs.forEach((line) => console.log(line));
    }
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : 0;

  console.log(`\n${'='.repeat(58)}`);
  console.log(`valid plans      : ${passed}/${cases.length}`);
  console.log(`total team cost  : ${totalCost.toFixed(2)} BDT`);
  console.log(`reference cost   : ${referenceCost.toFixed(2)} BDT`);
  console.log(`overall quality  : ${referenceCost > 0 ? Math.min(1, referenceCost / totalCost).toFixed(3) : 'n/a'}`);
  console.log(`latency          : min ${latencies[0] ?? 0} ms / p95 ${p95} ms / max ${latencies[latencies.length - 1] ?? 0} ms`);
  console.log(`${'='.repeat(58)}`);

  process.exit(passed === cases.length ? 0 : 1);
}

main();
