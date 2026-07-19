import { NextRequest, NextResponse } from 'next/server';
import { lakebaseQuery } from '@/lib/databricks/lakebase';
import { appUser } from '@/lib/trustdesk/user';
import { ALL_CAPABILITIES } from '@/lib/trustdesk/types';
import { GEO_LEVELS } from '@/lib/desert/types';
import type { Scenario } from '@/lib/desert/types';

const TRACKS = new Set(['medical_desert_planner', 'facility_trust_desk']);

interface PostBody {
  name?: unknown;
  track?: unknown;
  capability?: unknown;
  geo_level?: unknown;
  geo_value?: unknown;
  filters_json?: unknown;
  snapshot_json?: unknown;
  note?: unknown;
}

interface DeleteBody {
  id?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * POST /api/scenarios — a planner saves the current Desert Planner controls +
 * result summary as a named scenario, attributed to their own identity. Unlike
 * facility overrides, scenarios are personal notebooks, not a team-visible layer.
 */
export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, track, capability, geo_level, geo_value, filters_json, snapshot_json, note } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const trackValue = typeof track === 'string' && TRACKS.has(track) ? track : 'medical_desert_planner';
  if (name.length > 120) {
    return NextResponse.json({ error: 'name must be 120 characters or fewer' }, { status: 400 });
  }
  if (capability !== undefined && capability !== null) {
    if (typeof capability !== 'string' || !ALL_CAPABILITIES.includes(capability)) {
      return NextResponse.json({ error: `Unknown capability: ${String(capability)}` }, { status: 400 });
    }
  }
  if (geo_level !== undefined && geo_level !== null) {
    if (typeof geo_level !== 'string' || !(GEO_LEVELS as readonly string[]).includes(geo_level)) {
      return NextResponse.json({ error: `Unknown geo_level: ${String(geo_level)}` }, { status: 400 });
    }
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 });
  }

  const user = appUser(req);

  try {
    const rows = await lakebaseQuery<Scenario>(
      `
        INSERT INTO planning_scenarios
          (app_user, name, track, capability, geo_level, geo_value, filters_json, snapshot_json, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `,
      [
        user,
        name.trim(),
        trackValue,
        typeof capability === 'string' ? capability : null,
        typeof geo_level === 'string' ? geo_level : null,
        typeof geo_value === 'string' ? geo_value : null,
        filters_json ?? null,
        snapshot_json ?? null,
        typeof note === 'string' ? note.trim() || null : null,
      ]
    );
    return NextResponse.json({ scenario: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * GET /api/scenarios — the caller's own saved scenarios, newest first. Scenarios
 * are personal (unlike facility overrides, which are team-visible), so this is
 * scoped to app_user rather than returning everyone's.
 */
export async function GET(req: NextRequest) {
  const user = appUser(req);
  try {
    const scenarios = await lakebaseQuery<Scenario>(
      `SELECT * FROM planning_scenarios WHERE app_user = $1 ORDER BY created_at DESC`,
      [user]
    );
    return NextResponse.json({ scenarios, you: user });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * DELETE /api/scenarios — removes the caller's own scenario. Scoped to app_user
 * so one planner can never delete another's saved scenario.
 */
export async function DELETE(req: NextRequest) {
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id } = body;
  const idNum = typeof id === 'number' ? id : typeof id === 'string' ? Number(id) : NaN;
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const user = appUser(req);

  try {
    const rows = await lakebaseQuery<{ id: number }>(
      `DELETE FROM planning_scenarios WHERE app_user = $1 AND id = $2 RETURNING id`,
      [user, idNum]
    );
    return NextResponse.json({ deleted: rows.length > 0 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
