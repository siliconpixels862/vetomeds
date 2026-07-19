import { NextRequest, NextResponse } from 'next/server';
import { execSql, type SqlParam } from '@/lib/databricks/sql';
import { ALL_CAPABILITIES } from '@/lib/trustdesk/types';
import { toBool } from '@/lib/trustdesk/parse';

const PINCODE_RE = /^[0-9]{6}$/;
const GEO_LEVELS = new Set(['state', 'district', 'pincode']);
const REGION_LIMIT = 300;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * GET /api/desert/facilities?capability=&pincode=&geo_level=&geo_value=
 *
 * Two modes:
 *  - pincode given  → every facility in that pincode with an assessment for the capability
 *                     (all statuses), status 'yes' first then by trust (the map/cell drill-through).
 *  - no pincode     → ALL facilities across the region (from geo_level/geo_value) that OFFER the
 *                     capability (status yes/unclear), so the drill-through shows real data by
 *                     default without the planner having to click a point first.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const capability = searchParams.get('capability');
  const pincode = searchParams.get('pincode');
  const geoLevel = searchParams.get('geo_level') ?? '';
  const geoValue = (searchParams.get('geo_value') ?? '').trim();

  if (!capability || !ALL_CAPABILITIES.includes(capability)) {
    return NextResponse.json({ error: `Unknown capability: ${String(capability)}` }, { status: 400 });
  }

  const SELECT = `
    SELECT
      f.facility_id AS facility_id,
      f.name AS name,
      f.facility_type AS facility_type,
      f.city AS city,
      f.state_raw AS state,
      f.pincode AS pincode,
      fc.status AS status,
      fc.evidence_sentence AS evidence_sentence,
      fc.grounded AS grounded,
      t.trust_score AS trust_score
    FROM data_legend.silver.facilities f
    JOIN data_legend.silver.facility_capabilities fc USING (facility_id)
    LEFT JOIN data_legend.gold.facility_trust t USING (facility_id)`;

  let sql: string;
  const params: SqlParam[] = [{ name: 'capability', value: capability }];
  let scope: 'pincode' | 'region';

  if (pincode) {
    if (!PINCODE_RE.test(pincode)) {
      return NextResponse.json({ error: `Invalid pincode: ${String(pincode)}` }, { status: 400 });
    }
    scope = 'pincode';
    params.push({ name: 'pincode', value: pincode });
    sql = `${SELECT}
      WHERE f.pincode = :pincode AND fc.capability = :capability
      ORDER BY CASE WHEN fc.status = 'yes' THEN 0 ELSE 1 END, t.trust_score DESC`;
  } else {
    // Region default: only facilities that offer the capability, restricted to the pincodes
    // that make up the current coverage view (via the gaps table) for a consistent set.
    scope = 'region';
    let geoFilter = '';
    if (geoLevel && GEO_LEVELS.has(geoLevel) && geoValue) {
      if (geoLevel === 'state') { geoFilter = 'AND g.state ILIKE :geo'; params.push({ name: 'geo', value: `%${geoValue}%` }); }
      else if (geoLevel === 'district') { geoFilter = 'AND g.district ILIKE :geo'; params.push({ name: 'geo', value: `%${geoValue}%` }); }
      else if (geoLevel === 'pincode') { geoFilter = 'AND g.pincode = :geo'; params.push({ name: 'geo', value: geoValue }); }
    }
    sql = `${SELECT}
      WHERE fc.capability = :capability
        AND fc.status IN ('yes','unclear')
        AND f.pincode IN (
          SELECT g.pincode FROM data_legend.gold.pincode_capability_gaps g
          WHERE g.capability = :capability ${geoFilter}
        )
      ORDER BY CASE WHEN fc.status = 'yes' THEN 0 ELSE 1 END, t.trust_score DESC
      LIMIT ${REGION_LIMIT}`;
  }

  try {
    const rows = await execSql(sql, params);
    const facilities = rows.map(row => ({
      facility_id: String(row.facility_id),
      name: String(row.name),
      facility_type: row.facility_type == null ? null : String(row.facility_type),
      city: row.city == null ? null : String(row.city),
      state: row.state == null ? null : String(row.state),
      pincode: row.pincode == null ? null : String(row.pincode),
      status: row.status as 'yes' | 'no' | 'unclear',
      evidence_sentence: row.evidence_sentence == null ? null : String(row.evidence_sentence),
      grounded: toBool(row.grounded),
      trust_score: row.trust_score == null ? null : Number(row.trust_score),
    }));

    return NextResponse.json({ facilities, scope, truncated: scope === 'region' && facilities.length >= REGION_LIMIT });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
