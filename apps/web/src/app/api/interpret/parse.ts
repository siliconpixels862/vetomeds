import { ALL_CAPABILITIES } from '@/lib/trustdesk/types';
import { GEO_LEVELS, type GeoLevel } from '@/lib/desert/types';

/** The raw intent object as produced by the model (all string fields). */
export interface ParsedInterpret {
  view: string;
  capability: string;
  geo_level: string;
  geo_value: string;
  note: string;
}

/** The model routing view — which existing deterministic page to run. */
export type InterpretView = 'desert' | 'trust_desk';

/**
 * Builds the intent-extraction prompt for `ai_query`. This is a COMMAND parser,
 * not a chatbot: the model only maps free text onto {view, capability, geo} that
 * then drives the existing deterministic Trust Desk / Desert APIs. The prompt is
 * built here (never string-concatenated into SQL) and bound as a `:prompt` param.
 */
export function buildInterpretPrompt(query: string): string {
  return (
    'You convert a healthcare planner query into strict JSON. Capabilities allowed: ' +
    'icu, emergency_24x7, trauma_center, ambulance, general_surgery, cardiac_surgery, ' +
    'orthopedic_surgery, anesthesiology_staff, oncology, dialysis, cardiology, neurology, ' +
    'pediatrics, obstetrics_gynecology, neonatal_nicu, ct_scan, mri, ultrasound, ' +
    'pathology_lab, ventilator, oxygen_supply. ' +
    'view is "desert" when the user asks about gaps/coverage/deserts/where/underserved, ' +
    'else "trust_desk" when they ask which facility can do X or to find/verify/rank facilities. ' +
    'geo_level in state|district|pincode|null. ' +
    'Output ONLY minified JSON: {"view":"","capability":"","geo_level":"","geo_value":"","note":""}. ' +
    'Map synonyms (maternity->obstetrics_gynecology, heart/cardiac->cardiology, ' +
    'kidney/dialysis->dialysis, cancer->oncology, NICU/newborn->neonatal_nicu, ' +
    'trauma->trauma_center, x-ray/imaging->ct_scan, scan->ct_scan, ' +
    'delivery/pregnancy->obstetrics_gynecology). ' +
    'If no capability is identifiable, set capability to "". ' +
    'Query: ' +
    query
  );
}

/**
 * Parses the raw `ai_query` output string into a ParsedInterpret. Defensive: strips
 * ```json fences, extracts the first {..} block, and JSON.parses it. Returns null on
 * anything unparseable so the caller can fall back to a clarify prompt. No network.
 */
export function parseInterpretJson(raw: unknown): ParsedInterpret | null {
  if (typeof raw !== 'string') return null;

  // Strip common markdown code fences, then isolate the first JSON object. The
  // brace-slice alone already survives fenced output, but stripping keeps intent clear.
  const stripped = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const o = obj as Record<string, unknown>;
  return {
    view: typeof o.view === 'string' ? o.view : '',
    capability: typeof o.capability === 'string' ? o.capability : '',
    geo_level: typeof o.geo_level === 'string' ? o.geo_level : '',
    geo_value: typeof o.geo_value === 'string' ? o.geo_value : '',
    note: typeof o.note === 'string' ? o.note : '',
  };
}

/** view defaults to 'desert' unless the model explicitly asked for the trust_desk view. */
export function coerceView(view: string): InterpretView {
  return view === 'trust_desk' ? 'trust_desk' : 'desert';
}

/** Only the three literal geo levels are honoured; the model's "null"/"" become null. */
export function coerceGeoLevel(geoLevel: string): GeoLevel | null {
  return (GEO_LEVELS as readonly string[]).includes(geoLevel) ? (geoLevel as GeoLevel) : null;
}

/** A capability is only accepted if it is in the fixed 21-item allowlist. */
export function coerceCapability(capability: string): string | null {
  return ALL_CAPABILITIES.includes(capability) ? capability : null;
}
