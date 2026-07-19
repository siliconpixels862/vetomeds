import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';
import { lakebaseQuery } from '@/lib/databricks/lakebase';
import { buildTrustDeskQuery, relaxationLadder, type RegionFilter } from '@/lib/trustdesk/search';
import { toBool } from '@/lib/trustdesk/parse';
import { effectiveStatus } from '@/lib/trustdesk/effective_status';
import type { TrustDeskResult, FacilityOverride } from '@/lib/trustdesk/types';

/**
 * Fetches the most recent override per facility_id for one capability, in a single
 * Lakebase round trip. When more than one planner has overridden the same
 * facility+capability, the most recently updated verdict wins for this aggregate
 * ranked view (the facility detail page still shows every planner's verdict).
 */
async function fetchLatestOverridesByFacility(
  facilityIds: string[],
  capability: string
): Promise<Map<string, FacilityOverride>> {
  if (facilityIds.length === 0) return new Map();

  const rows = await lakebaseQuery<FacilityOverride>(
    `SELECT * FROM facility_overrides WHERE facility_id = ANY($1) AND capability = $2 ORDER BY updated_at DESC`,
    [facilityIds, capability]
  );

  const byFacility = new Map<string, FacilityOverride>();
  for (const row of rows) {
    // Rows are ordered newest-first; keep only the first (latest) one seen per facility.
    if (!byFacility.has(row.facility_id)) {
      byFacility.set(row.facility_id, row);
    }
  }
  return byFacility;
}

/** verified-yes first, then machine order, verified-no last. Stable across ties. */
function overrideRank(result: TrustDeskResult): number {
  if (result.effective.verified && result.effective.status === 'yes') return 0;
  if (result.effective.verified && result.effective.status === 'no') return 2;
  return 1;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const capability = searchParams.get('capability');
  const state = searchParams.get('state') ?? undefined;
  const city = searchParams.get('city') ?? undefined;
  const pincode = searchParams.get('pincode') ?? undefined;

  if (!capability) {
    return NextResponse.json({ error: 'Missing required query param: capability' }, { status: 400 });
  }

  // Validate capability up front (throws on unknown).
  try {
    buildTrustDeskQuery(capability);
  } catch {
    return NextResponse.json({ error: `Unknown capability: ${capability}` }, { status: 400 });
  }

  const requested: RegionFilter = {};
  if (state?.trim()) requested.state = state.trim();
  if (city?.trim()) requested.city = city.trim();
  if (pincode?.trim()) requested.pincode = pincode.trim();

  try {
    // Progressive relaxation: try the full filter, then drop the most brittle
    // fields until we get matches, so a typo'd state or a data-sparse PIN never
    // hides real facilities. First non-empty subset wins.
    const ladder = relaxationLadder(requested.state, requested.city, requested.pincode);
    let rows: Awaited<ReturnType<typeof execSql>> = [];
    let applied: RegionFilter = {};
    for (const f of ladder) {
      const built = buildTrustDeskQuery(capability, f.state, f.city, f.pincode);
      rows = await execSql(built.sql, built.params);
      applied = f;
      if (rows.length > 0) break;
    }

    const dropped = (['state', 'city', 'pincode'] as const).filter(
      k => requested[k] && !applied[k]
    );

    const facilityIds = rows.map(row => String(row.facility_id));
    const overridesByFacility = await fetchLatestOverridesByFacility(facilityIds, capability);

    const results: TrustDeskResult[] = rows.map(row => {
      const capability_status = row.capability_status as 'yes' | 'unclear';
      const override = overridesByFacility.get(String(row.facility_id)) ?? null;
      return {
        facility_id: String(row.facility_id),
        name: String(row.name),
        facility_type: row.facility_type == null ? null : String(row.facility_type),
        city: row.city == null ? null : String(row.city),
        state: row.state == null ? null : String(row.state),
        pincode: row.pincode == null ? null : String(row.pincode),
        trust_score: Number(row.trust_score),
        capability_status,
        evidence_sentence: row.evidence_sentence == null ? null : String(row.evidence_sentence),
        source_field: row.source_field == null ? null : String(row.source_field),
        grounded: toBool(row.grounded),
        hard_flag_count: Number(row.hard_flag_count ?? 0),
        effective: effectiveStatus({ status: capability_status }, override),
      };
    });

    results.sort((a, b) => overrideRank(a) - overrideRank(b));

    return NextResponse.json({ results, requested, applied, dropped, relaxed: dropped.length > 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
