import { DirectiveInterpretation } from './types';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `
You are an expert Smart Grid & Energy Management AI Parser for campus energy optimization.
Your task is to analyze natural language operator notes (1 to 3 notes) and extract energy optimization directives.

For EACH note provided in the array, you must return a directive object in the exact array order matching note_index (0, 1, 2).

Allowed Directive Types:
1. "solar_reduction": Usable rooftop solar is reduced.
   - structured_adjustment: { "hours": [array of integers 0..23], "factor": number between 0.0 and 1.0 }
   - Rule: factor is the USABLE fraction remaining. An 80% reduction means factor = 0.2. 25% of forecast means factor = 0.25.
2. "minimum_battery_reserve": High reserve required for battery SOC.
   - structured_adjustment: { "hours": [array of integers 0..23], "directive_min_kwh": number >= 0 }
3. "no_charge_window": Battery charging is strictly forbidden.
   - structured_adjustment: { "hours": [array of integers 0..23] }
4. "no_discharge_window": Battery discharging is strictly forbidden.
   - structured_adjustment: { "hours": [array of integers 0..23] }
5. "max_grid_window": Grid power import is capped.
   - structured_adjustment: { "hours": [array of integers 0..23], "max_grid_kwh": number >= 0 }
6. "no_op": Note is informational, distractor, or does not affect today's energy schedule.
   - applies MUST BE false.
   - structured_adjustment MUST BE null.

TIME WINDOW RULES:
- Windows are start-inclusive and end-exclusive.
- 12 PM (noon) to 2 PM -> hours [12, 13]
- 2 AM to 5 AM -> hours [2, 3, 4]
- 5 PM to 9 PM (17:00 to 21:00) -> hours [17, 18, 19, 20]
- 6 PM to 9 PM (18:00 to 21:00) -> hours [18, 19, 20]
- 2 PM to 5 PM (14:00 to 17:00) -> hours [14, 15, 16]
- Hours must be unique integers from 0 to 23 in ascending order.

OUTPUT JSON FORMAT (return ONLY this JSON, no markdown, no extra text):
{
  "directives": [
    {
      "note_index": 0,
      "applies": true,
      "directive_type": "solar_reduction",
      "structured_adjustment": { "hours": [12, 13], "factor": 0.25 },
      "explanation": "Brief explanation of the directive."
    }
  ]
}
`;

/**
 * Fallback Rule-Based Parser for offline or keyless operation.
 */
function parseNoteFallback(note: string, index: number): DirectiveInterpretation {
  const lower = note.toLowerCase();

  const getHoursFromText = (text: string): number[] => {
    let startHour: number | null = null;
    let endHour: number | null = null;

    if (text.includes('noon')) startHour = 12;
    if (text.includes('midnight')) startHour = 0;

    const timeRangeRegex = /(?:from\s+)?(\d{1,2})\s*(am|pm)?\s*(?:to|until|-|through)\s*(\d{1,2})\s*(am|pm)?/i;
    const match = text.match(timeRangeRegex);

    if (match) {
      let s = parseInt(match[1], 10);
      let sAmpm = match[2]?.toLowerCase();
      let e = parseInt(match[3], 10);
      let eAmpm = match[4]?.toLowerCase();

      if (!sAmpm && eAmpm) sAmpm = eAmpm;

      if (sAmpm === 'pm' && s < 12) s += 12;
      if (sAmpm === 'am' && s === 12) s = 0;
      if (eAmpm === 'pm' && e < 12) e += 12;
      if (eAmpm === 'am' && e === 12) e = 0;

      startHour = s;
      endHour = e;
    }

    if (startHour !== null && endHour !== null && endHour > startHour) {
      const hours: number[] = [];
      for (let h = startHour; h < endHour; h++) {
        if (h >= 0 && h <= 23) hours.push(h);
      }
      return hours;
    }

    return [];
  };

  // Solar Reduction
  if (lower.includes('solar') || lower.includes('panel')) {
    if (lower.includes('wash') || lower.includes('clean') || lower.includes('reduc') || lower.includes('cloud') || lower.includes('shade') || lower.includes('storm')) {
      const hours = getHoursFromText(lower);
      let factor = 0.5;

      const pctMatch = lower.match(/(\d+)%\s*of/);
      if (pctMatch) {
        factor = parseFloat(pctMatch[1]) / 100;
      } else {
        const reductionMatch = lower.match(/(\d+)%/);
        if (reductionMatch) {
          const val = parseFloat(reductionMatch[1]);
          if (lower.includes('reduced by') || lower.includes('drop by') || lower.includes('reduction of') || lower.includes('down by')) {
            factor = Math.max(0, (100 - val) / 100);
          } else {
            factor = val / 100;
          }
        }
      }

      const validHours = hours.length > 0 ? hours : [12, 13];
      return {
        note_index: index,
        applies: true,
        directive_type: 'solar_reduction',
        structured_adjustment: { hours: validHours, factor },
        explanation: `Usable solar reduced to ${(factor * 100).toFixed(0)}% during specified window.`,
      };
    }
  }

  // No Charge Window
  if ((lower.includes('charger') || lower.includes('charge') || lower.includes('charging')) &&
      (lower.includes('maintenance') || lower.includes('isolated') || lower.includes('do not charge') || lower.includes('disable') || lower.includes('no charge') || lower.includes('offline'))) {
    const hours = getHoursFromText(lower);
    const validHours = hours.length > 0 ? hours : [2, 3, 4];
    return {
      note_index: index,
      applies: true,
      directive_type: 'no_charge_window',
      structured_adjustment: { hours: validHours },
      explanation: 'Battery charging prohibited during maintenance window.',
    };
  }

  // No Discharge Window
  if ((lower.includes('discharge') || lower.includes('drain') || lower.includes('discharging')) &&
      (lower.includes('do not') || lower.includes('prohibit') || lower.includes('prevent') || lower.includes('no discharge') || lower.includes('blocked') || lower.includes('offline'))) {
    const hours = getHoursFromText(lower);
    const validHours = hours.length > 0 ? hours : [18, 19, 20];
    return {
      note_index: index,
      applies: true,
      directive_type: 'no_discharge_window',
      structured_adjustment: { hours: validHours },
      explanation: 'Battery discharging prohibited during specified window.',
    };
  }

  // Minimum Battery Reserve
  if (lower.includes('reserve') || lower.includes('keep battery') || lower.includes('minimum battery') || lower.includes('at least') || lower.includes('must remain above')) {
    const hours = getHoursFromText(lower);
    const validHours = hours.length > 0 ? hours : [17, 18, 19, 20];
    let directive_min_kwh = 100;

    const numMatch = lower.match(/(\d+)\s*kwh/);
    if (numMatch) directive_min_kwh = parseFloat(numMatch[1]);

    const pctMatch = lower.match(/(\d+)%/);
    if (pctMatch && !numMatch) {
      // If percent is given without kwh, store as a flag (guardrails will handle)
      directive_min_kwh = parseFloat(pctMatch[1]);
    }

    return {
      note_index: index,
      applies: true,
      directive_type: 'minimum_battery_reserve',
      structured_adjustment: { hours: validHours, directive_min_kwh },
      explanation: `Minimum battery reserve raised to ${directive_min_kwh} kWh during window.`,
    };
  }

  // Max Grid Window
  if (lower.includes('grid') && (lower.includes('limit') || lower.includes('cap') || lower.includes('max') || lower.includes('restrict') || lower.includes('cannot exceed'))) {
    const hours = getHoursFromText(lower);
    const validHours = hours.length > 0 ? hours : [14, 15, 16];
    let max_grid_kwh = 100;

    const numMatch = lower.match(/(\d+)\s*(?:kw|kwh)/);
    if (numMatch) max_grid_kwh = parseFloat(numMatch[1]);

    return {
      note_index: index,
      applies: true,
      directive_type: 'max_grid_window',
      structured_adjustment: { hours: validHours, max_grid_kwh },
      explanation: `Grid power import capped at ${max_grid_kwh} kWh during specified window.`,
    };
  }

  // Default Distractor / No-Op
  return {
    note_index: index,
    applies: false,
    directive_type: 'no_op',
    structured_adjustment: null,
    explanation: 'Note does not contain operational energy directives for today.',
  };
}

function parseDirectivesFromText(text: string, noteCount: number): DirectiveInterpretation[] | null {
  try {
    // Strip any markdown code fences if present
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.directives && Array.isArray(parsed.directives) && parsed.directives.length > 0) {
      return parsed.directives;
    }
  } catch {
    // Try to extract JSON from the text
    const match = text.match(/\{[\s\S]*"directives"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.directives && Array.isArray(parsed.directives)) {
          return parsed.directives;
        }
      } catch {}
    }
  }
  return null;
}

export async function interpretOperatorNotes(notes: string[]): Promise<DirectiveInterpretation[]> {
  if (!notes || notes.length === 0) return [];

  const provider = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const userContent = JSON.stringify({ operator_notes: notes });

  // ── Tier 1A: NVIDIA NIM (OpenAI-compatible) ──────────────────────────────
  if ((provider === 'nvidia' || provider === 'auto') && nvidiaKey) {
    try {
      const nvidiaClient = new OpenAI({
        apiKey: nvidiaKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
        timeout: 25000,
      });

      const completion = await nvidiaClient.chat.completions.create({
        model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      });

      const content = completion.choices[0]?.message?.content || '';
      const directives = parseDirectivesFromText(content, notes.length);
      if (directives) {
        console.log('[LLM] Using NVIDIA NIM provider');
        return directives;
      }
    } catch (err) {
      console.warn('[LLM] NVIDIA NIM failed, trying next provider:', (err as Error).message);
    }
  }

  // ── Tier 1B: OpenAI ───────────────────────────────────────────────────────
  if ((provider === 'openai' || provider === 'auto') && openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiKey, timeout: 25000 });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = completion.choices[0]?.message?.content || '';
      const directives = parseDirectivesFromText(content, notes.length);
      if (directives) {
        console.log('[LLM] Using OpenAI provider');
        return directives;
      }
    } catch (err) {
      console.warn('[LLM] OpenAI failed, trying next provider:', (err as Error).message);
    }
  }

  // ── Tier 1C: Google Gemini ────────────────────────────────────────────────
  if ((provider === 'gemini' || provider === 'auto') && geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const response = await model.generateContent(
        `${SYSTEM_PROMPT}\n\nOperator Notes:\n${userContent}`
      );

      const text = response.response.text();
      const directives = parseDirectivesFromText(text, notes.length);
      if (directives) {
        console.log('[LLM] Using Gemini provider');
        return directives;
      }
    } catch (err) {
      console.warn('[LLM] Gemini failed, falling back to rule parser:', (err as Error).message);
    }
  }

  // ── Tier 1D: Deterministic Fallback Rule Parser ───────────────────────────
  console.log('[LLM] Using deterministic fallback parser');
  return notes.map((note, idx) => parseNoteFallback(note, idx));
}
