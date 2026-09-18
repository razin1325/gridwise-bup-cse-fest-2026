import { NextRequest, NextResponse } from 'next/server';
import { processEnergyOptimizationScenario, ValidationError, InternalOptimizationError } from '@/lib/pipeline';

export async function POST(req: NextRequest) {
  // ── Parse JSON (malformed body → 400) ─────────────────────────────────────
  let body: any;
  try {
    const text = await req.text();
    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid Payload', message: 'Request body is empty. Please provide a valid scenario JSON object.' },
        { status: 400 }
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', message: 'Malformed JSON payload provided in request body.' },
      { status: 400 }
    );
  }

  // ── Run the 3-tier pipeline ────────────────────────────────────────────────
  try {
    const result = await processEnergyOptimizationScenario(body);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('[optimize-energy]', error.name, error.message);

    // Gap 2 Fix: correct HTTP status classification
    if (error instanceof ValidationError) {
      // 400 — client sent a structurally invalid or semantically rejected request
      return NextResponse.json(
        { error: 'Invalid Scenario', message: error.message },
        { status: 400 }
      );
    }

    if (error instanceof InternalOptimizationError) {
      // 500 — solver or LLM failed internally; input was valid
      return NextResponse.json(
        { error: 'Optimization Failed', message: error.message },
        { status: 500 }
      );
    }

    // Unexpected uncaught error → 500
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message || 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
