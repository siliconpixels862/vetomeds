import { NextResponse } from 'next/server';

/**
 * Lightweight liveness probe for Render's Health Check Path. Does NO external calls,
 * so it returns 200 instantly even while the Databricks serverless warehouse is cold —
 * Render won't mark the service unhealthy during warehouse cold starts.
 * (For a deep readiness check that verifies the SQL warehouse + Lakebase, use /api/health.)
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, service: 'vetomeds', time: new Date().toISOString() });
}
