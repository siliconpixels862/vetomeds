import { NextRequest, NextResponse } from 'next/server';
import { lakebaseQuery } from '@/lib/databricks/lakebase';
import { ALL_CAPABILITIES } from '@/lib/trustdesk/search';
import { appUser } from '@/lib/trustdesk/user';
import type { FacilityOverride } from '@/lib/trustdesk/types';

const VALID_VERDICTS = ['yes', 'no', 'unclear'];

interface PostBody {
  facility_id?: unknown;
  capability?: unknown;
  human_verdict?: unknown;
  note?: unknown;
  machine_status?: unknown;
  machine_score?: unknown;
}

interface DeleteBody {
  facility_id?: unknown;
  capability?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * POST /api/overrides — a planner records (or updates) their human verdict for one
 * facility+capability. UPSERTs on (app_user, facility_id, capability): re-submitting
 * replaces the caller's own prior verdict/note, it never creates duplicates.
 */
export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { facility_id, capability, human_verdict, note, machine_status, machine_score } = body;

  if (typeof facility_id !== 'string' || !facility_id) {
    return NextResponse.json({ error: 'facility_id is required' }, { status: 400 });
  }
  if (typeof capability !== 'string' || !ALL_CAPABILITIES.includes(capability)) {
    return NextResponse.json({ error: `Unknown capability: ${String(capability)}` }, { status: 400 });
  }
  if (typeof human_verdict !== 'string' || !VALID_VERDICTS.includes(human_verdict)) {
    return NextResponse.json({ error: `Invalid human_verdict: ${String(human_verdict)}` }, { status: 400 });
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 });
  }

  const user = appUser(req);

  try {
    const rows = await lakebaseQuery<FacilityOverride>(
      `
        INSERT INTO facility_overrides (app_user, facility_id, capability, machine_status, machine_score, human_verdict, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (app_user, facility_id, capability)
        DO UPDATE SET human_verdict=EXCLUDED.human_verdict, note=EXCLUDED.note,
          machine_status=EXCLUDED.machine_status, machine_score=EXCLUDED.machine_score, updated_at=now()
        RETURNING *
      `,
      [
        user,
        facility_id,
        capability,
        typeof machine_status === 'string' ? machine_status : null,
        typeof machine_score === 'number' ? machine_score : null,
        human_verdict,
        typeof note === 'string' ? note : null,
      ]
    );
    return NextResponse.json({ override: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * GET /api/overrides?facility_id=... — every planner's overrides for a facility
 * (team-visible, not just the caller's own), newest first. Also returns `you`
 * (the caller's resolved identity) so the client can tell which rows are its own
 * for prefill/remove affordances.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const facilityId = searchParams.get('facility_id');

  if (!facilityId) {
    return NextResponse.json({ error: 'Missing required query param: facility_id' }, { status: 400 });
  }

  try {
    const overrides = await lakebaseQuery<FacilityOverride>(
      `SELECT * FROM facility_overrides WHERE facility_id = $1 ORDER BY updated_at DESC`,
      [facilityId]
    );
    return NextResponse.json({ overrides, you: appUser(req) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * DELETE /api/overrides — removes the caller's own override for a facility+capability.
 * Scoped to app_user so one planner can never delete another's verdict.
 */
export async function DELETE(req: NextRequest) {
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { facility_id, capability } = body;
  if (typeof facility_id !== 'string' || !facility_id || typeof capability !== 'string' || !capability) {
    return NextResponse.json({ error: 'facility_id and capability are required' }, { status: 400 });
  }

  const user = appUser(req);

  try {
    const rows = await lakebaseQuery<{ id: number }>(
      `DELETE FROM facility_overrides WHERE app_user = $1 AND facility_id = $2 AND capability = $3 RETURNING id`,
      [user, facility_id, capability]
    );
    return NextResponse.json({ deleted: rows.length > 0 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
