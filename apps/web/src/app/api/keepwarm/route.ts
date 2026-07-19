import { NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';

/**
 * Best-effort warehouse keep-warm. The chat page pings this on mount and on an interval
 * so the Databricks serverless warehouse is already awake by the time the planner runs a
 * real query — avoiding the cold-start "fetch failed" on the first request.
 */
export async function GET() {
  try {
    await execSql('SELECT 1 AS ok');
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Never surface an error for a keep-warm ping; the real query path has its own retry.
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
