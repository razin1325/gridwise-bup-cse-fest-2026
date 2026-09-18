import { ScenarioInput, DirectiveInterpretation, SanitizedScenario, DirectiveType } from './types';

export function sanitizeAndValidateScenario(
  input: any,
  rawDirectives: DirectiveInterpretation[]
): SanitizedScenario {
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    throw new Error('Invalid payload: scenario must be a valid JSON object.');
  }

  const scenario_id = typeof input.scenario_id === 'string' && input.scenario_id.trim().length > 0
    ? input.scenario_id.trim()
    : 'GRID-UNKNOWN';

  // 1. Validate Operator Notes
  const operator_notes: string[] = [];
  if (Array.isArray(input.operator_notes)) {
    for (const note of input.operator_notes) {
      if (typeof note === 'string' && note.trim().length > 0) {
        operator_notes.push(note.trim());
      }
    }
  }
  if (operator_notes.length === 0) {
    throw new Error('Validation Error: operator_notes must contain between 1 and 3 non-empty strings.');
  }
  if (operator_notes.length > 3) {
    warnings.push('operator_notes exceeded 3 items; keeping first 3 notes.');
    operator_notes.splice(3);
  }

  // 2. Validate Battery Config
  const b = input.battery || {};
  const battery = {
    capacity_kwh: Math.max(0, Number(b.capacity_kwh) || 200),
    initial_energy_kwh: Math.max(0, Number(b.initial_energy_kwh) || 100),
    minimum_energy_kwh: Math.max(0, Number(b.minimum_energy_kwh) || 20),
    max_charge_kwh_per_hour: Math.max(0, Number(b.max_charge_kwh_per_hour) || 50),
    max_discharge_kwh_per_hour: Math.max(0, Number(b.max_discharge_kwh_per_hour) || 50),
  };

  if (battery.initial_energy_kwh > battery.capacity_kwh) {
    warnings.push(`initial_energy_kwh (${battery.initial_energy_kwh}) > capacity_kwh (${battery.capacity_kwh}); clamping to capacity.`);
    battery.initial_energy_kwh = battery.capacity_kwh;
  }
  if (battery.minimum_energy_kwh > battery.capacity_kwh) {
    warnings.push(`minimum_energy_kwh (${battery.minimum_energy_kwh}) > capacity_kwh; clamping.`);
    battery.minimum_energy_kwh = battery.capacity_kwh;
  }

  // 3. Validate Hours (Must be exactly 24 hours 0..23)
  const rawHours = Array.isArray(input.hours) ? input.hours : [];
  const hourMap = new Map<number, any>();

  for (const hObj of rawHours) {
    if (hObj && typeof hObj.hour === 'number' && hObj.hour >= 0 && hObj.hour <= 23) {
      hourMap.set(hObj.hour, hObj);
    }
  }

  if (hourMap.size !== 24) {
    warnings.push(`Expected 24 unique hourly objects (0-23), found ${hourMap.size}. Synthesizing missing hours.`);
  }

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const existing = hourMap.get(h) || {};
    hours.push({
      hour: h,
      demand_kwh: Math.max(0, Number(existing.demand_kwh) || 0),
      solar_kwh: Math.max(0, Number(existing.solar_kwh) || 0),
      tariff_bdt_per_kwh: Math.max(0, Number(existing.tariff_bdt_per_kwh) || 5),
    });
  }

  // Sort by hour ascending
  hours.sort((a, b) => a.hour - b.hour);

  // 4. Validate & Sanitize Directive Interpretations
  const allowedDirectiveTypes: DirectiveType[] = [
    'solar_reduction',
    'minimum_battery_reserve',
    'no_charge_window',
    'no_discharge_window',
    'max_grid_window',
    'no_op',
  ];

  const sanitizedDirectives: DirectiveInterpretation[] = [];

  operator_notes.forEach((note, idx) => {
    const rawDir = rawDirectives[idx] || {
      note_index: idx,
      applies: false,
      directive_type: 'no_op',
      structured_adjustment: null,
      explanation: 'No interpretation generated.',
    };

    let directive_type: DirectiveType = allowedDirectiveTypes.includes(rawDir.directive_type)
      ? rawDir.directive_type
      : 'no_op';

    let applies = Boolean(rawDir.applies);
    let structured_adjustment: any = rawDir.structured_adjustment;
    let explanation = rawDir.explanation || 'Processed directive.';

    if (directive_type === 'no_op' || !applies || !structured_adjustment) {
      applies = false;
      directive_type = 'no_op';
      structured_adjustment = null;
    } else {
      // Validate hours in structured_adjustment
      let adjHours: number[] = Array.isArray(structured_adjustment.hours)
        ? structured_adjustment.hours
            .map((h: any) => Number(h))
            .filter((h: number) => !isNaN(h) && h >= 0 && h <= 23)
        : [];

      // Sort & deduplicate hours
      adjHours = Array.from(new Set(adjHours)).sort((a, b) => a - b);

      if (adjHours.length === 0) {
        warnings.push(`Note index ${idx} directive had no valid hours (0-23); marking as no_op.`);
        applies = false;
        directive_type = 'no_op';
        structured_adjustment = null;
      } else {
        switch (directive_type) {
          case 'solar_reduction': {
            let factor = Number(structured_adjustment.factor);
            if (isNaN(factor) || factor < 0 || factor > 1) {
              warnings.push(`Note index ${idx} invalid factor ${structured_adjustment.factor}; clamping to [0, 1].`);
              factor = Math.min(1, Math.max(0, isNaN(factor) ? 1 : factor));
            }
            structured_adjustment = { hours: adjHours, factor };
            break;
          }
          case 'minimum_battery_reserve': {
            let reqMin = Number(structured_adjustment.minimum_energy_kwh ?? structured_adjustment.directive_min_kwh);
            if (isNaN(reqMin)) reqMin = 0;
            // If expressed as a percentage <= 1 (e.g. 0.3 for 30%), or <= 100 percentage
            if (reqMin > 0 && reqMin <= 1 && battery.capacity_kwh > 0) {
              reqMin = reqMin * battery.capacity_kwh;
            }
            let minimum_energy_kwh = Math.max(0, Math.min(reqMin, battery.capacity_kwh));
            structured_adjustment = { hours: adjHours, minimum_energy_kwh };
            break;
          }
          case 'no_charge_window': {
            structured_adjustment = { hours: adjHours };
            break;
          }
          case 'no_discharge_window': {
            structured_adjustment = { hours: adjHours };
            break;
          }
          case 'max_grid_window': {
            let max_grid_kwh = Math.max(0, Number(structured_adjustment.max_grid_kwh) || 0);
            structured_adjustment = { hours: adjHours, max_grid_kwh };
            break;
          }
          default: {
            applies = false;
            directive_type = 'no_op';
            structured_adjustment = null;
            break;
          }
        }
      }
    }

    sanitizedDirectives.push({
      note_index: idx,
      applies,
      directive_type,
      structured_adjustment,
      explanation,
    });
  });

  return {
    scenario_id,
    operator_notes,
    hours,
    battery,
    directives: sanitizedDirectives,
    warnings,
  };
}
