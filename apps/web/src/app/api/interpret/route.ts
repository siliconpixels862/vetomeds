import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';
import {
  buildInterpretPrompt,
  parseInterpretJson,
  coerceView,
  coerceGeoLevel,
  coerceCapability,
} from './parse';

/** The Databricks Foundation Model endpoint used to parse the natural-language command. */
const AI_MODEL = 'databricks-meta-llama-3-3-70b-instruct';

const CLARIFY_MESSAGE =
  'I couldn\'t pin down a capability. Try e.g. "dialysis gaps in Bihar" or name one: ICU, cardiology, oncology, maternity…';

interface PostBody {
  query?: unknown;
}

/**
 * POST /api/interpret — turns one plain-English command ("cardiology gaps in Bihar")
 * into a structured intent {view, capability, geo_level, geo_value} using `ai_query`.
 *
 * This is a COMMAND parser, not a chatbot: it only routes the query onto the existing
 * deterministic Trust Desk / Desert endpoints — it never composes a prose answer. The
 * user text is bound as a `:prompt` SQL parameter (never string-concatenated into SQL).
 */
export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json(
      { ok: false, error: 'Missing required field: query' },
      { status: 400 }
    );
  }

  const prompt = buildInterpretPrompt(query);

  let rawParsed: string;
  try {
    const rows = await execSql(`SELECT ai_query('${AI_MODEL}', :prompt) AS parsed`, [
      { name: 'prompt', value: prompt },
    ]);
    rawParsed = rows[0]?.parsed == null ? '' : String(rows[0].parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: `Couldn't interpret that right now (${detail}). You can use the Trust Desk or Desert Planner pages directly.`,
      },
      { status: 500 }
    );
  }

  const parsed = parseInterpretJson(rawParsed);
  if (!parsed) {
    return NextResponse.json({ ok: false, clarify: CLARIFY_MESSAGE, raw: rawParsed });
  }

  const capability = coerceCapability(parsed.capability);
  if (!capability) {
    return NextResponse.json({ ok: false, clarify: CLARIFY_MESSAGE, raw: rawParsed });
  }

  const view = coerceView(parsed.view);
  const geo_level = coerceGeoLevel(parsed.geo_level);
  const geo_value = geo_level && parsed.geo_value.trim() ? parsed.geo_value.trim() : null;
  const note = parsed.note.trim() || null;

  return NextResponse.json({ ok: true, view, capability, geo_level, geo_value, note });
}
