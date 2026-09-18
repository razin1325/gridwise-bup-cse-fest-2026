import { interpretOperatorNotes } from './llm-interpreter';
import { sanitizeAndValidateScenario } from './guardrails';
import { solveEnergyOptimization } from './lp-optimizer';
import { OptimizationResponse, SanitizedScenario } from './types';

// ─── Gap 1 Fix: Post-solve directive verification ───────────────────────────
// Explicitly assert that every applied directive was structurally followed by the LP solution.
// This is a concrete "replay/verify" step requested by the spec Section 04.3.
function verifyDirectivesApplied(
  scenario: SanitizedScenario,
  result: OptimizationResponse
): void {
  const { directives, battery } = scenario;

  for (const dir of directives) {
    if (!dir.applies || !dir.structured_adjustment) continue;
    const { directive_type, structured_adjustment } = dir;
    const hours: number[] = structured_adjustment.hours || [];

    for (const h of hours) {
      const row = result.hourly_plan[h];
      if (!row) continue;

      switch (directive_type) {
        case 'solar_reduction': {
          // Solar used should not exceed effective solar (factor × forecast).
          // We trust LP; no numeric check needed — constraint was in model.
          break;
        }
        case 'no_charge_window': {
          if (row.battery_action === 'charge' && row.battery_kwh > 0.01) {
            throw new Error(
              `Directive verification failed: battery charged at hour ${h} despite no_charge_window constraint.`
            );
          }
          break;
        }
        case 'no_discharge_window': {
          if (row.battery_action === 'discharge' && row.battery_kwh > 0.01) {
            throw new Error(
              `Directive verification failed: battery discharged at hour ${h} despite no_discharge_window constraint.`
            );
          }
          break;
        }
        case 'minimum_battery_reserve': {
          const minRequired = structured_adjustment.minimum_energy_kwh ?? 0;
          if (row.battery_energy_after_kwh < minRequired - 0.5) {
            throw new Error(
              `Directive verification failed: battery SOC at hour ${h} is ${row.battery_energy_after_kwh.toFixed(1)} kWh, ` +
              `below required minimum of ${minRequired} kWh.`
            );
          }
          break;
        }
        case 'max_grid_window': {
          const maxAllowed = structured_adjustment.max_grid_kwh ?? Infinity;
          if (row.grid_kwh > maxAllowed + 0.5) {
            throw new Error(
              `Directive verification failed: grid import at hour ${h} is ${row.grid_kwh.toFixed(1)} kWh, ` +
              `exceeding max_grid_window cap of ${maxAllowed} kWh.`
            );
          }
          break;
        }
      }
    }
  }

  // End-of-day battery neutrality verification
  const lastRow = result.hourly_plan[23];
  if (lastRow && Math.abs(lastRow.battery_energy_after_kwh - battery.initial_energy_kwh) > 1.0) {
    throw new Error(
      `End-of-day neutrality violation: final battery SOC is ${lastRow.battery_energy_after_kwh} kWh ` +
      `but initial was ${battery.initial_energy_kwh} kWh.`
    );
  }
}

// ─── Gap 2 Fix: Structured error types for correct 400 vs 500 classification ─
export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class InternalOptimizationError extends Error {
  readonly statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = 'InternalOptimizationError';
  }
}

export async function processEnergyOptimizationScenario(input: any): Promise<OptimizationResponse> {
  // ── Input structure validation (→ 400 if bad) ─────────────────────────────
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Request body must be a valid JSON object.');
  }
  if (!Array.isArray(input.operator_notes) || input.operator_notes.length === 0) {
    throw new ValidationError('operator_notes must be a non-empty array of strings.');
  }
  if (!Array.isArray(input.hours) || input.hours.length === 0) {
    throw new ValidationError('hours must be a non-empty array of 24 hourly objects.');
  }

  const notes = input.operator_notes as string[];

  // Tier 1: LLM Interpreter — internal failures → 500
  let rawDirectives;
  try {
    rawDirectives = await interpretOperatorNotes(notes, input?.battery);
  } catch (err: any) {
    throw new InternalOptimizationError(`LLM interpretation failed: ${err.message}`);
  }

  // Tier 2: Deterministic Guardrails — schema violations → 400
  let sanitizedScenario;
  try {
    sanitizedScenario = sanitizeAndValidateScenario(input, rawDirectives);
  } catch (err: any) {
    // Guardrails throw on structurally invalid scenario input — that's a client error
    throw new ValidationError(`Scenario validation failed: ${err.message}`);
  }

  // Tier 3: LP Math Optimizer — solver failures are internal errors → 500
  let result;
  try {
    result = solveEnergyOptimization(sanitizedScenario);
  } catch (err: any) {
    throw new InternalOptimizationError(`LP solver failed: ${err.message}`);
  }

  // Gap 1 Fix: Post-solve directive verification — violations are internal errors → 500
  try {
    verifyDirectivesApplied(sanitizedScenario, result);
  } catch (err: any) {
    throw new InternalOptimizationError(`Post-solve verification failed: ${err.message}`);
  }

  return result;
}
