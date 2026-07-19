import type { SqlParam } from '@/lib/databricks/sql';
import { ALL_CAPABILITIES } from '@/lib/trustdesk/types';
import { GEO_LEVELS, type DesertSummary, type GeoLevel } from './types';

export { ALL_CAPABILITIES, GEO_LEVELS };

/**
 * Shared validation + WHERE-clause construction for the desert queries.
 *
 * `capability` is validated against the fixed 21-item allowlist before being
 * interpolated into the SQL string (never taken directly from user input).
 * `geoLevel` selects which column to filter on — it is validated against a fixed
 * set of literals and is ALSO never interpolated as a value; only the raw
 * `geoValue` is bound as a `:geo` parameter, so it can never be used to inject SQL.
 */
function buildDesertWhere(
  capability: string,
  geoLevel?: GeoLevel,
  geoValue?: string
): { params: SqlParam[]; geoFilter: string } {
  if (!ALL_CAPABILITIES.includes(capability)) {
    throw new Error(`Unknown capability: ${capability}`);
  }

  const params: SqlParam[] = [{ name: 'capability', value: capability }];
  let geoFilter = '';

  if (geoLevel !== undefined) {
    if (!GEO_LEVELS.includes(geoLevel)) {
      throw new Error(`Unknown geoLevel: ${geoLevel}`);
    }
    if (geoValue) {
      params.push({ name: 'geo', value: geoValue });
      if (geoLevel === 'state') {
        geoFilter = "AND g.state ILIKE '%'||:geo||'%'";
      } else if (geoLevel === 'district') {
        geoFilter = "AND g.district ILIKE '%'||:geo||'%'";
      } else {
        geoFilter = 'AND g.pincode = :geo';
      }
    }
  }

  return { params, geoFilter };
}

/**
 * Builds the parameterized three-state coverage query for the Medical Desert Planner.
 *
 * The gaps table (`data_legend.gold.pincode_capability_gaps`) has no lat/lng, so
 * we LEFT JOIN a per-pincode centroid computed from `silver.facilities` — cells
 * whose pincode has no facility with coordinates come back with lat/lng NULL and
 * are the caller's responsibility to handle honestly (excluded from a map, kept
 * in a table).
 *
 * This query is capped at 500 rows for display purposes — it is NOT a reliable
 * source for the three-state summary counts when a capability+region has more
 * than 500 matching cells. Use `buildDesertSummaryQuery` for the summary.
 */
export function buildDesertQuery(
  capability: string,
  geoLevel?: GeoLevel,
  geoValue?: string
): { sql: string; params: SqlParam[] } {
  const { params, geoFilter } = buildDesertWhere(capability, geoLevel, geoValue);

  const sql = `
    SELECT
      g.pincode AS pincode,
      g.district AS district,
      g.state AS state,
      g.desert_state AS desert_state,
      g.facilities_in_pin AS facilities_in_pin,
      g.yes_count AS yes_count,
      g.unclear_count AS unclear_count,
      g.trust_weighted_yes AS trust_weighted_yes,
      g.avg_coverage AS avg_coverage,
      c.lat AS lat,
      c.lng AS lng
    FROM data_legend.gold.pincode_capability_gaps g
    LEFT JOIN (
      SELECT pincode, avg(latitude) AS lat, avg(longitude) AS lng
      FROM data_legend.silver.facilities
      WHERE pincode RLIKE '^[0-9]{6}$'
      GROUP BY pincode
    ) c ON g.pincode = c.pincode
    WHERE g.capability = :capability
      ${geoFilter}
    ORDER BY
      CASE g.desert_state
        WHEN 'medical_desert' THEN 0
        WHEN 'data_desert' THEN 1
        WHEN 'covered' THEN 2
        ELSE 3
      END,
      g.facilities_in_pin DESC
    LIMIT 500
  `.trim();

  return { sql, params };
}

/**
 * Builds the parameterized aggregate query backing the three-state summary strip.
 *
 * Unlike `buildDesertQuery`, this runs over ALL matching rows (no LIMIT, no centroid
 * join) so the covered/medical_desert/data_desert counts stay honest even when a
 * capability+region has more than 500 matching cells — the cap that bounds the cell
 * list shown in the table/map.
 */
export function buildDesertSummaryQuery(
  capability: string,
  geoLevel?: GeoLevel,
  geoValue?: string
): { sql: string; params: SqlParam[] } {
  const { params, geoFilter } = buildDesertWhere(capability, geoLevel, geoValue);

  const sql = `
    SELECT
      g.desert_state AS desert_state,
      COUNT(*) AS n
    FROM data_legend.gold.pincode_capability_gaps g
    WHERE g.capability = :capability
      ${geoFilter}
    GROUP BY desert_state
  `.trim();

  return { sql, params };
}

/** Tallies cells into the three-state summary; unrecognized states are ignored rather than throwing. */
export function summarize(cells: { desert_state: string }[]): DesertSummary {
  const summary: DesertSummary = { covered: 0, medical_desert: 0, data_desert: 0 };
  for (const cell of cells) {
    if (cell.desert_state === 'covered') summary.covered += 1;
    else if (cell.desert_state === 'medical_desert') summary.medical_desert += 1;
    else if (cell.desert_state === 'data_desert') summary.data_desert += 1;
  }
  return summary;
}

/**
 * Builds the three-state summary from the aggregate `buildDesertSummaryQuery` rows
 * (one row per `desert_state` with a count `n`). States absent from the aggregate
 * (no matching rows) come back as 0 rather than being omitted.
 */
export function summaryFromAggregate(rows: { desert_state: string; n: number | string }[]): DesertSummary {
  const summary: DesertSummary = { covered: 0, medical_desert: 0, data_desert: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    if (row.desert_state === 'covered') summary.covered = n;
    else if (row.desert_state === 'medical_desert') summary.medical_desert = n;
    else if (row.desert_state === 'data_desert') summary.data_desert = n;
  }
  return summary;
}
