import type { SqlParam } from '@/lib/databricks/sql';
import { ALL_CAPABILITIES } from './types';

// Re-exported so callers that validate a capability value (e.g. the overrides API)
// can import the single source-of-truth allowlist from here.
export { ALL_CAPABILITIES };

export interface RegionFilter {
  state?: string;
  city?: string;
  pincode?: string;
}

/**
 * Builds the parameterized ranked-search SQL for the Trust Desk.
 *
 * The capability is validated against the fixed 21-item allowlist before being
 * interpolated into the SQL string — it is never taken from user input directly,
 * which prevents SQL injection through an identifier-like value. All other
 * user-supplied filters (state/city/pincode) are passed as bound `:name` params.
 */
export function buildTrustDeskQuery(
  capability: string,
  state?: string,
  city?: string,
  pincode?: string
): { sql: string; params: SqlParam[] } {
  if (!ALL_CAPABILITIES.includes(capability)) {
    throw new Error(`Unknown capability: ${capability}`);
  }

  const params: SqlParam[] = [{ name: 'capability', value: capability }];
  const filters: string[] = [];

  if (state) {
    filters.push('AND f.state_raw ILIKE :state');
    params.push({ name: 'state', value: `%${state}%` });
  }
  if (city) {
    filters.push('AND f.city ILIKE :city');
    params.push({ name: 'city', value: `%${city}%` });
  }
  if (pincode) {
    filters.push('AND f.pincode = :pincode');
    params.push({ name: 'pincode', value: pincode });
  }

  const sql = `
    SELECT
      f.facility_id AS facility_id,
      f.name AS name,
      f.facility_type AS facility_type,
      f.city AS city,
      f.state_raw AS state,
      f.pincode AS pincode,
      t.trust_score AS trust_score,
      fc.status AS capability_status,
      fc.evidence_sentence AS evidence_sentence,
      fc.source_field AS source_field,
      fc.grounded AS grounded,
      size(t.hard_flags) AS hard_flag_count
    FROM data_legend.silver.facility_capabilities fc
    JOIN data_legend.silver.facilities f USING (facility_id)
    JOIN data_legend.gold.facility_trust t USING (facility_id)
    WHERE fc.capability = :capability
      AND fc.status IN ('yes','unclear')
      AND t.junk_corporate_flag = 0
      ${filters.join('\n      ')}
    ORDER BY
      CASE WHEN fc.status = 'yes' THEN 0 ELSE 1 END,
      fc.grounded DESC,
      t.trust_score DESC
    LIMIT 50
  `.trim();

  return { sql, params };
}

/**
 * Progressive-relaxation ladder of region filter subsets, from the most specific
 * (all provided filters) to the least (capability only). Used when the full
 * filter returns zero rows so the planner still sees the best available matches
 * instead of a hard empty result — a misspelled state or a data-sparse PIN should
 * not hide real facilities.
 *
 * City and PIN are treated as more reliable than the free-text `state_raw` field
 * (which is frequently misspelled/dirty in the source), so subsets that keep city
 * are ranked above subsets that keep only state. Only fields actually provided are
 * included; duplicate subsets are removed while preserving order.
 */
export function relaxationLadder(state?: string, city?: string, pincode?: string): RegionFilter[] {
  const s = state?.trim() || undefined;
  const c = city?.trim() || undefined;
  const p = pincode?.trim() || undefined;

  const candidates: RegionFilter[] = [
    { state: s, city: c, pincode: p },
    { state: s, city: c },
    { city: c, pincode: p },
    { city: c },
    { state: s, pincode: p },
    { state: s },
    { pincode: p },
    {},
  ];

  const seen = new Set<string>();
  const ladder: RegionFilter[] = [];
  for (const cand of candidates) {
    const f: RegionFilter = {};
    if (cand.state) f.state = cand.state;
    if (cand.city) f.city = cand.city;
    if (cand.pincode) f.pincode = cand.pincode;
    const sig = `${f.state ?? ''}|${f.city ?? ''}|${f.pincode ?? ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    ladder.push(f);
  }
  return ladder;
}
