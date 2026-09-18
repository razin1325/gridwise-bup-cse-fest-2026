import { BatteryInput, DirectiveInterpretation } from './types';
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
   - structured_adjustment: { "hours": [array of integers 0..23], "minimum_energy_kwh": number >= 0 }
3. "no_charge_window": Battery charging is strictly forbidden.
   - structured_adjustment: { "hours": [array of integers 0..23] }
4. "no_discharge_window": Battery discharging is strictly forbidden.
   - structured_adjustment: { "hours": [array of integers 0..23] }
5. "max_grid_window": Grid power import is capped.
   - structured_adjustment: { "hours": [array of integers 0..23], "max_grid_kwh": number >= 0 }
6. "no_op": Note is informational, distractor, or does not affect today's energy schedule.
   - applies MUST BE false.
   - structured_adjustment MUST BE null.

RELATIVE VALUE RULES:
- The user message includes the battery configuration of the current scenario.
- Convert relative expressions such as "50% of the battery capacity", "half the battery", or "a quarter of capacity" into an absolute kWh value using capacity_kwh.
- A reserve value must never exceed the provided capacity_kwh.

TIME WINDOW RULES:
- Windows are start-inclusive and end-exclusive.
- 12 PM (noon) to 2 PM -> hours [12, 13]
- 2 AM to 5 AM -> hours [2, 3, 4]
- 5 PM to 9 PM (17:00 to 21:00) -> hours [17, 18, 19, 20]
- 6 PM to 9 PM (18:00 to 21:00) -> hours [18, 19, 20]
- 2 PM to 5 PM (14:00 to 17:00) -> hours [14, 15, 16]
- "from 10 AM until noon" -> [10, 11]
- "between 11 AM and 2 PM" -> [11, 12, 13]
- "from noon until 2 PM" -> [12, 13]
- "1-3 PM" or "1 PM to 3 PM" -> [13, 14]
- "from 6 PM until midnight" -> [18, 19, 20, 21, 22, 23]

CRITICAL HOURS RULES:
- hours must contain ONLY the hours inside the stated window for that note.
- Never extend a window to hours that the note does not mention.
- If a note states one window, the listed hours must be contiguous.
- Do not merge the time windows of different notes into one hours array.
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

const TIME_TOKEN = '(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)';
const TIME_RANGE_REGEX = new RegExp(
  `(?:from\\s+|between\\s+)?(${TIME_TOKEN})\\s*(?:to|until|till|through|thru|and|–|—|-)\\s*(${TIME_TOKEN})`,
  'i'
);
const PROHIBITION_REGEX = /(not|never|no |without|unavailab|isolat|disabl|offline|maintenance|suspend|block|prohibit|prevent|forbid|out of service|shut|cannot|can't)/;

const WORD_FRACTIONS: Array<[RegExp, number]> = [
  [/\bone[\s-]?fifth\b/, 0.2],
  [/\bone[\s-]?tenth\b/, 0.1],
  [/\bone[\s-]?quarter\b|\ba quarter\b/, 0.25],
  [/\bthree[\s-]?quarters?\b/, 0.75],
  [/\bone[\s-]?third\b/, 1 / 3],
  [/\btwo[\s-]?thirds?\b/, 2 / 3],
  [/\bhalf\b/, 0.5],
];

function hourTokenToNumber(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'noon') return 12;
  if (t === 'midnight') return 0;

  const match = t.match(/^(\d{1,2})(?::\d{2})?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const meridiem = match[2];
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return hour >= 0 && hour <= 23 ? hour : null;
}

/** Start-inclusive, end-exclusive hour window, e.g. "between 11 AM and 2 PM" -> [11, 12, 13]. */
function getHoursFromText(text: string): number[] {
  const match = text.match(TIME_RANGE_REGEX);
  if (!match) return [];

  let start = hourTokenToNumber(match[1]);
  let end = hourTokenToNumber(match[2]);
  if (start === null || end === null) return [];

  // Inherit the meridiem when only one side of the range states it ("6 to 9 PM").
  // "noon"/"midnight" are already absolute and must not be reinterpreted:
  // "10 AM until noon" ends at 12, not at midnight.
  const startText = match[1].trim().toLowerCase();
  const endText = match[2].trim().toLowerCase();
  const startMeridiem = startText.match(/\b(am|pm)\b/)?.[1];
  const endMeridiem = endText.match(/\b(am|pm)\b/)?.[1];
  const startIsAbsolute = startText === 'noon' || startText === 'midnight';
  const endIsAbsolute = endText === 'noon' || endText === 'midnight';

  if (!startMeridiem && !startIsAbsolute && endMeridiem) {
    if (endMeridiem === 'pm' && start < 12) start += 12;
    if (endMeridiem === 'am' && start === 12) start = 0;
  } else if (startMeridiem && !endMeridiem && !endIsAbsolute) {
    if (startMeridiem === 'pm' && end < 12) end += 12;
    if (startMeridiem === 'am' && end === 12) end = 0;
  }

  if (end === 0) end = 24; // "until midnight" runs to the end of the day

  const hours: number[] = [];
  for (let h = start; h < end && h <= 23; h++) {
    if (h >= 0) hours.push(h);
  }
  return hours;
}

/** Usable fraction remaining. An "80% reduction" means 0.2, "25% of forecast" means 0.25. */
function extractUsableFraction(text: string): number | null {
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const value = parseFloat(pctMatch[1]);
    const statesRemoval =
      /\d\s*%\s*(?:reduction|drop|decline|decrease|loss|cut|less)/.test(text) ||
      /\b(?:reduced|dropped|declined|decreased|cut|down|fall|fallen)\s+by\s+\d/.test(text) ||
      /\breduction\s+of\s+\d/.test(text) ||
      /\bby\s+\d+(?:\.\d+)?\s*%/.test(text);
    return statesRemoval ? Math.max(0, (100 - value) / 100) : Math.min(1, value / 100);
  }

  for (const [pattern, fraction] of WORD_FRACTIONS) {
    if (pattern.test(text)) return fraction;
  }
  return null;
}

/**
 * Fallback Rule-Based Parser for offline, keyless, or provider-failure operation.
 * Used only when no configured LLM provider returns a usable interpretation.
 */
function parseNoteFallback(note: string, index: number, capacityKwh?: number): DirectiveInterpretation {
  const lower = (typeof note === 'string' ? note : String(note || '')).toLowerCase();
  const hours = getHoursFromText(lower);

  // Solar Reduction
  if (lower.includes('solar') || lower.includes('panel') || /\bpv\b/.test(lower)) {
    const fraction = extractUsableFraction(lower);
    const reductionWord = /(wash|clean|reduc|cloud|shade|storm|drop|declin|decreas|dust|maintenance|inspect|fog|haze|rain|overcast)/.test(lower);
    if (fraction !== null || reductionWord) {
      const factor = fraction ?? 0.5;
      return {
        note_index: index,
        applies: true,
        directive_type: 'solar_reduction',
        structured_adjustment: { hours: hours.length > 0 ? hours : [12, 13], factor },
        explanation: `Usable solar reduced to ${(factor * 100).toFixed(0)}% during the stated window.`,
      };
    }
  }

  // No Charge Window
  if (/\bcharg/.test(lower) && PROHIBITION_REGEX.test(lower)) {
    return {
      note_index: index,
      applies: true,
      directive_type: 'no_charge_window',
      structured_adjustment: { hours: hours.length > 0 ? hours : [2, 3, 4] },
      explanation: 'Battery charging is unavailable during the stated window.',
    };
  }

  // No Discharge Window
  if (/\bdischarg/.test(lower) && PROHIBITION_REGEX.test(lower)) {
    return {
      note_index: index,
      applies: true,
      directive_type: 'no_discharge_window',
      structured_adjustment: { hours: hours.length > 0 ? hours : [18, 19, 20] },
      explanation: 'Battery discharging is unavailable during the stated window.',
    };
  }

  // Minimum Battery Reserve
  if ((lower.includes('battery') || lower.includes('reserve')) && /(reserve|at least|minimum|remain|keep|requires)/.test(lower)) {
    const kwhMatch = lower.match(/(\d+(?:\.\d+)?)\s*kwh/);
    let minimum_energy_kwh: number | null = null;

    if (kwhMatch) {
      minimum_energy_kwh = parseFloat(kwhMatch[1]);
    } else if (capacityKwh) {
      const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
      const fraction = pctMatch ? parseFloat(pctMatch[1]) / 100 : extractUsableFraction(lower);
      if (fraction !== null) minimum_energy_kwh = fraction * capacityKwh;
    }

    // Without a resolvable quantity, inventing a reserve would be worse than ignoring the note.
    if (minimum_energy_kwh !== null) {
      minimum_energy_kwh = Math.round(minimum_energy_kwh * 100) / 100;
      return {
        note_index: index,
        applies: true,
        directive_type: 'minimum_battery_reserve',
        structured_adjustment: { hours: hours.length > 0 ? hours : [17, 18, 19, 20], minimum_energy_kwh },
        explanation: `Minimum battery reserve raised to ${minimum_energy_kwh} kWh during the stated window.`,
      };
    }
  }

  // Max Grid Window
  if (
    /(grid|import|feeder|substation|transformer)/.test(lower) &&
    /(limit|cap|maximum|max\b|restrict|exceed|below|under|no more than|at most|constrain)/.test(lower)
  ) {
    const kwhMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:kwh|kw)/);
    const max_grid_kwh = kwhMatch ? parseFloat(kwhMatch[1]) : 100;
    return {
      note_index: index,
      applies: true,
      directive_type: 'max_grid_window',
      structured_adjustment: { hours: hours.length > 0 ? hours : [14, 15, 16], max_grid_kwh },
      explanation: `Grid power import capped at ${max_grid_kwh} kWh during the stated window.`,
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

export async function interpretOperatorNotes(
  notes: string[],
  battery?: Partial<BatteryInput>
): Promise<DirectiveInterpretation[]> {
  if (!notes || notes.length === 0) return [];

  const provider = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  // The battery configuration is required context: notes such as "keep at least
  // 50% of capacity in reserve" cannot be resolved to kWh without it.
  const batteryContext = battery
    ? {
        capacity_kwh: battery.capacity_kwh,
        initial_energy_kwh: battery.initial_energy_kwh,
        minimum_energy_kwh: battery.minimum_energy_kwh,
        max_charge_kwh_per_hour: battery.max_charge_kwh_per_hour,
        max_discharge_kwh_per_hour: battery.max_discharge_kwh_per_hour,
      }
    : undefined;

  const userContent = JSON.stringify({ operator_notes: notes, battery: batteryContext });

  // ── Tier 1A: NVIDIA NIM (OpenAI-compatible) ──────────────────────────────
  if ((provider === 'nvidia' || provider === 'auto') && nvidiaKey) {
    try {
      const nvidiaClient = new OpenAI({
        apiKey: nvidiaKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
        // 8 s per provider keeps worst-case 3-provider chain at ~24 s — safely
        // under the 30 s judging deadline. maxRetries=0: the default of 2 would
        // multiply the timeout to ~25 s for this provider alone.
        timeout: 8000,
        maxRetries: 0,
      });

      const completion = await nvidiaClient.chat.completions.create({
        model: process.env.NVIDIA_MODEL || 'mistralai/mistral-nemotron',
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
      const openai = new OpenAI({ apiKey: openaiKey, timeout: 8000, maxRetries: 0 });
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

      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), 8000);
      let text = '';
      try {
        const response = await model.generateContent(
          `${SYSTEM_PROMPT}\n\nOperator Notes:\n${userContent}`,
          { signal: ac.signal } as any
        );
        text = response.response.text();
      } finally {
        clearTimeout(abortTimer);
      }
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
  return notes.map((note, idx) => parseNoteFallback(note, idx, batteryContext?.capacity_kwh));
}
