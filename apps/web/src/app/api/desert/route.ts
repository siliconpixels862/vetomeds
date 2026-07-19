import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';
import { buildDesertQuery, buildDesertSummaryQuery, summaryFromAggregate } from '@/lib/desert/query';
import { GEO_LEVELS, type DesertCell, type GeoLevel } from '@/lib/desert/types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGeoLevel(value: string): value is GeoLevel {
  return (GEO_LEVELS as readonly string[]).includes(value);
}

/**
 * GET /api/desert?capability=&geo_level=&geo_value= — the three-state coverage
 * grid (covered / medical_desert / data_desert) for one capability, optionally
 * narrowed to a state/district/pincode, plus per-state counts for the summary strip.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const capability = searchParams.get('capability');
  const geoLevelRaw = searchParams.get('geo_level');
  const geoValue = searchParams.get('geo_value') ?? undefined;

  if (!capability) {
    return NextResponse.json({ error: 'Missing required query param: capability' }, { status: 400 });
  }

  let geoLevel: GeoLevel | undefined;
  if (geoLevelRaw) {
    if (!isGeoLevel(geoLevelRaw)) {
      return NextResponse.json({ error: `Unknown geo_level: ${geoLevelRaw}` }, { status: 400 });
    }
    geoLevel = geoLevelRaw;
  }

  let cellsQuery: ReturnType<typeof buildDesertQuery>;
  let summaryQuery: ReturnType<typeof buildDesertSummaryQuery>;
  try {
    cellsQuery = buildDesertQuery(capability, geoLevel, geoValue);
    summaryQuery = buildDesertSummaryQuery(capability, geoLevel, geoValue);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }

  try {
    const [cellRows, summaryRows] = await Promise.all([
      execSql(cellsQuery.sql, cellsQuery.params),
      execSql(summaryQuery.sql, summaryQuery.params),
    ]);
    const cells: DesertCell[] = cellRows.map(row => ({
      pincode: String(row.pincode),
      district: row.district == null ? null : String(row.district),
      state: row.state == null ? null : String(row.state),
      desert_state: row.desert_state as DesertCell['desert_state'],
      facilities_in_pin: Number(row.facilities_in_pin),
      yes_count: Number(row.yes_count),
      unclear_count: Number(row.unclear_count),
      trust_weighted_yes: Number(row.trust_weighted_yes),
      avg_coverage: Number(row.avg_coverage),
      lat: row.lat == null ? null : Number(row.lat),
      lng: row.lng == null ? null : Number(row.lng),
    }));
    const summary = summaryFromAggregate(
      summaryRows as { desert_state: string; n: number | string }[]
    );
    const total_cells = summary.covered + summary.medical_desert + summary.data_desert;
    const cells_truncated = total_cells > cells.length;
    return NextResponse.json({ cells, summary, total_cells, cells_truncated });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
