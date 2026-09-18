import { NextRequest, NextResponse } from 'next/server';
import { processEnergyOptimizationScenario } from '@/lib/pipeline';

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      const text = await req.text();
      if (!text || text.trim().length === 0) {
        return NextResponse.json(
          {
            error: 'Invalid Payload',
            message: 'Request body is empty. Please provide a valid scenario JSON object.',
          },
          { status: 400 }
        );
      }
      body = JSON.parse(text);
    } catch (parseError) {
      return NextResponse.json(
        {
          error: 'Invalid JSON',
          message: 'Malformed JSON payload provided in request body.',
        },
        { status: 400 }
      );
    }

    const result = await processEnergyOptimizationScenario(body);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('Error in /optimize-energy:', error);
    return NextResponse.json(
      {
        error: 'Scenario Processing Failed',
        message: error.message || 'An unexpected error occurred during optimization.',
      },
      { status: 400 }
    );
  }
}
