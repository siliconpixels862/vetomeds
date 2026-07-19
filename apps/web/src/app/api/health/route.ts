import { NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';
import { lakebaseQuery } from '@/lib/databricks/lakebase';

export async function GET() {
  try {
    const sqlRows = await execSql('SELECT COUNT(*) AS n FROM data_legend.silver.facilities');
    const sqlCount = Number(sqlRows[0]?.n ?? 0);

    const lakebaseRows = await lakebaseQuery<Record<string, unknown>>(
      'SELECT COUNT(*) FROM facility_overrides'
    );
    const lakebaseCount = Number(Object.values(lakebaseRows[0] ?? {})[0] ?? 0);

    return NextResponse.json({ sql: sqlCount, lakebase: lakebaseCount, ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
