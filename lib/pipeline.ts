import { interpretOperatorNotes } from './llm-interpreter';
import { sanitizeAndValidateScenario } from './guardrails';
import { solveEnergyOptimization } from './lp-optimizer';
import { OptimizationResponse } from './types';

export async function processEnergyOptimizationScenario(input: any): Promise<OptimizationResponse> {
  const notes = Array.isArray(input?.operator_notes) ? input.operator_notes : [];

  // Tier 1: LLM Interpreter
  const rawDirectives = await interpretOperatorNotes(notes);

  // Tier 2: Deterministic Guardrails
  const sanitizedScenario = sanitizeAndValidateScenario(input, rawDirectives);

  // Tier 3: LP Math Optimizer
  const result = solveEnergyOptimization(sanitizedScenario);

  return result;
}
