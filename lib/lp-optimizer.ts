import solver from 'javascript-lp-solver';
import { SanitizedScenario, OptimizationResponse, HourlyPlanItem, BatteryAction } from './types';

export function solveEnergyOptimization(scenario: SanitizedScenario): OptimizationResponse {
  const { scenario_id, hours, battery, directives } = scenario;

  // 1. Calculate effective parameters per hour (0..23)
  const effectiveSolar: number[] = new Array(24).fill(0);
  const activeMinBattery: number[] = new Array(24).fill(battery.minimum_energy_kwh);
  const maxChargeRate: number[] = new Array(24).fill(battery.max_charge_kwh_per_hour);
  const maxDischargeRate: number[] = new Array(24).fill(battery.max_discharge_kwh_per_hour);
  const maxGridCap: number[] = new Array(24).fill(Infinity);

  // Initialize effective solar from forecast
  hours.forEach((hObj) => {
    effectiveSolar[hObj.hour] = hObj.solar_kwh;
  });

  // Apply operator directives
  directives.forEach((dir) => {
    if (!dir.applies || !dir.structured_adjustment) return;
    const { directive_type, structured_adjustment } = dir;
    const targetHours = structured_adjustment.hours || [];

    targetHours.forEach((h) => {
      if (h < 0 || h > 23) return;

      switch (directive_type) {
        case 'solar_reduction': {
          const factor = (structured_adjustment as any).factor;
          if (typeof factor === 'number') {
            effectiveSolar[h] *= factor;
          }
          break;
        }
        case 'minimum_battery_reserve': {
          const reqMin = (structured_adjustment as any).minimum_energy_kwh ?? (structured_adjustment as any).directive_min_kwh;
          if (typeof reqMin === 'number') {
            activeMinBattery[h] = Math.max(activeMinBattery[h], reqMin);
          }
          break;
        }
        case 'no_charge_window': {
          maxChargeRate[h] = 0;
          break;
        }
        case 'no_discharge_window': {
          maxDischargeRate[h] = 0;
          break;
        }
        case 'max_grid_window': {
          const cap = (structured_adjustment as any).max_grid_kwh;
          if (typeof cap === 'number') {
            maxGridCap[h] = Math.min(maxGridCap[h], cap);
          }
          break;
        }
      }
    });
  });

  // Clamp active minimum battery to capacity
  for (let h = 0; h < 24; h++) {
    activeMinBattery[h] = Math.min(activeMinBattery[h], battery.capacity_kwh);
  }

  // 2. Build Linear Programming Model using explicit constraints
  const constraints: Record<string, { equal?: number; min?: number; max?: number }> = {};
  const variables: Record<string, Record<string, number>> = {};

  // Energy balance, state transition & bound constraints per hour
  for (let h = 0; h < 24; h++) {
    const demand = hours[h].demand_kwh;
    constraints[`balance_${h}`] = { equal: demand };

    if (h === 0) {
      constraints[`battery_trans_${h}`] = { equal: battery.initial_energy_kwh };
    } else {
      constraints[`battery_trans_${h}`] = { equal: 0 };
    }

    // Bound constraints
    constraints[`solar_cap_${h}`] = { max: effectiveSolar[h] };
    constraints[`charge_cap_${h}`] = { max: maxChargeRate[h] };
    constraints[`discharge_cap_${h}`] = { max: maxDischargeRate[h] };

    if (maxGridCap[h] !== Infinity) {
      constraints[`grid_cap_${h}`] = { max: maxGridCap[h] };
    }

    constraints[`bat_min_${h}`] = { min: activeMinBattery[h] };
    constraints[`bat_max_${h}`] = { max: battery.capacity_kwh };
  }

  // End-of-Day Neutrality Constraint (battery_energy[23] === initial_energy_kwh)
  constraints['battery_neutrality'] = { equal: battery.initial_energy_kwh };

  // Variables per hour
  for (let h = 0; h < 24; h++) {
    const tariff = hours[h].tariff_bdt_per_kwh;

    // grid_h
    const gridObj: Record<string, number> = {
      cost: tariff,
      [`balance_${h}`]: 1,
    };
    if (maxGridCap[h] !== Infinity) {
      gridObj[`grid_cap_${h}`] = 1;
    }
    variables[`grid_${h}`] = gridObj;

    // solar_used_h
    variables[`solar_used_${h}`] = {
      cost: 0,
      [`balance_${h}`]: 1,
      [`solar_cap_${h}`]: 1,
    };

    // charge_h
    variables[`charge_${h}`] = {
      cost: 0.0001, // tiny cost to prioritize direct solar usage over round-trip charging
      [`balance_${h}`]: -1,
      [`battery_trans_${h}`]: -1,
      [`charge_cap_${h}`]: 1,
    };

    // discharge_h
    variables[`discharge_${h}`] = {
      cost: 0,
      [`balance_${h}`]: 1,
      [`battery_trans_${h}`]: 1,
      [`discharge_cap_${h}`]: 1,
    };

    // battery_energy_h
    const batteryObj: Record<string, number> = {
      cost: 0,
      [`battery_trans_${h}`]: 1,
      [`bat_min_${h}`]: 1,
      [`bat_max_${h}`]: 1,
    };

    if (h < 23) {
      batteryObj[`battery_trans_${h + 1}`] = -1;
    } else {
      batteryObj['battery_neutrality'] = 1;
    }

    variables[`battery_energy_${h}`] = batteryObj;
  }

  const model = {
    optimize: 'cost',
    opType: 'min' as const,
    constraints,
    variables,
  };

  const lpResult = solver.Solve(model);

  if (!lpResult || lpResult.feasible === false) {
    throw new Error('Optimization Error: Linear Programming solver could not find a feasible energy plan under given constraints.');
  }

  // 3. Extract Hourly Plan and Metrics
  const hourly_plan: HourlyPlanItem[] = [];
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;

  for (let h = 0; h < 24; h++) {
    const grid_kwh = Math.round(Math.max(0, lpResult[`grid_${h}`] || 0) * 100) / 100;
    const solar_used_kwh = Math.round(Math.max(0, lpResult[`solar_used_${h}`] || 0) * 100) / 100;
    const charge_kwh = Math.max(0, lpResult[`charge_${h}`] || 0);
    const discharge_kwh = Math.max(0, lpResult[`discharge_${h}`] || 0);
    const battery_energy_after_kwh = Math.round(Math.max(0, lpResult[`battery_energy_${h}`] || 0) * 100) / 100;

    let battery_action: BatteryAction = 'idle';
    let battery_kwh = 0;

    if (charge_kwh > 0.001) {
      battery_action = 'charge';
      battery_kwh = Math.round(charge_kwh * 100) / 100;
    } else if (discharge_kwh > 0.001) {
      battery_action = 'discharge';
      battery_kwh = Math.round(discharge_kwh * 100) / 100;
    }

    total_grid_kwh += grid_kwh;
    total_cost_bdt += grid_kwh * hours[h].tariff_bdt_per_kwh;
    if (grid_kwh > peak_grid_kwh) {
      peak_grid_kwh = grid_kwh;
    }

    hourly_plan.push({
      hour: h,
      grid_kwh,
      solar_used_kwh,
      battery_action,
      battery_kwh,
      battery_energy_after_kwh,
    });
  }

  total_grid_kwh = Math.round(total_grid_kwh * 100) / 100;
  total_cost_bdt = Math.round(total_cost_bdt * 100) / 100;
  peak_grid_kwh = Math.round(peak_grid_kwh * 100) / 100;

  // Formulate Plan Summary
  const appliedCount = directives.filter((d) => d.applies).length;
  const plan_summary = appliedCount > 0
    ? `Optimized energy schedule applying ${appliedCount} operator directive(s). Battery charged during low-tariff hours and discharged during peak-tariff windows while maintaining end-of-day SOC neutrality (${battery.initial_energy_kwh} kWh).`
    : `Standard cost-minimization energy schedule. Battery charged during off-peak hours and discharged during high-tariff hours while restoring initial battery level (${battery.initial_energy_kwh} kWh).`;

  return {
    scenario_id,
    directive_interpretation: directives,
    hourly_plan,
    total_grid_kwh,
    total_cost_bdt,
    peak_grid_kwh,
    plan_summary,
  };
}
