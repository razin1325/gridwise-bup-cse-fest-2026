import fs from 'fs';
import path from 'path';
import { processEnergyOptimizationScenario } from './lib/pipeline';

async function testAllSampleCases() {
  console.log('--- RUNNING GRIDWISE OPTIMIZATION PIPELINE TEST ---\n');

  const samplePath = path.join(process.cwd(), 'BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json');
  if (!fs.existsSync(samplePath)) {
    console.error('Sample cases file not found!');
    process.exit(1);
  }

  const fileData = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const cases = fileData.cases || [];

  console.log(`Loaded ${cases.length} public sample test cases.\n`);

  let passed = 0;
  for (const c of cases) {
    console.log(`--------------------------------------------------`);
    console.log(`Testing Case: [${c.id}] ${c.label}`);
    try {
      const result = await processEnergyOptimizationScenario(c.input);

      console.log(`Directive Interpretations (${result.directive_interpretation.length}):`);
      result.directive_interpretation.forEach((dir: any) => {
        console.log(`  - Note #${dir.note_index} [${dir.directive_type}] applies=${dir.applies} :: ${dir.explanation}`);
      });

      console.log(`Results:`);
      console.log(`  - Total Cost (BDT): ${result.total_cost_bdt}`);
      console.log(`  - Total Grid (kWh): ${result.total_grid_kwh}`);
      console.log(`  - Peak Grid (kWh):  ${result.peak_grid_kwh}`);
      console.log(`  - Hourly Plan Count: ${result.hourly_plan.length}`);

      // Verify constraints
      const endBattery = result.hourly_plan[23].battery_energy_after_kwh;
      const initBattery = c.input.battery.initial_energy_kwh;
      console.log(`  - Battery End Neutrality: ${endBattery} kWh (Initial: ${initBattery} kWh)`);

      if (Math.abs(endBattery - initBattery) < 0.05) {
        console.log(`  [PASS] Case ${c.id} feasible & neutral.`);
        passed++;
      } else {
        console.error(`  [FAIL] End-of-day battery neutrality violated!`);
      }
    } catch (err: any) {
      console.error(`  [ERROR] Case ${c.id} failed:`, err.message);
    }
    console.log(`\n`);
  }

  console.log(`==================================================`);
  console.log(`SUMMARY: ${passed} / ${cases.length} sample cases passed constraint verification successfully!`);
}

testAllSampleCases();
