import { NextResponse } from 'next/server';
import { execSql } from '@/lib/databricks/sql';
import { toBool } from '@/lib/trustdesk/parse';
import type { FacilityDetail } from '@/lib/trustdesk/types';

/**
 * Databricks returns ARRAY columns as JSON-encoded strings over the REST API; parse defensively.
 * Source data sometimes contains null elements inside otherwise-valid arrays (e.g. a missing
 * source URL) — those are dropped rather than surfaced as `null` to callers expecting `string[]`.
 */
function parseArrayColumn(value: unknown): string[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      arr = [];
    }
  } else {
    arr = [];
  }
  return (arr as unknown[]).filter((v): v is string => typeof v === 'string');
}

function parseHardFlags(value: unknown): { rule: string; penalty: number }[] {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(f => {
    const flag = f as Record<string, unknown>;
    return { rule: String(flag.rule ?? ''), penalty: Number(flag.penalty ?? 0) };
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const facilityRows = await execSql(
      `
        SELECT
          f.facility_id AS facility_id,
          f.name AS name,
          f.facility_type AS facility_type,
          f.city AS city,
          f.state_raw AS state,
          f.pincode AS pincode,
          f.description AS description,
          f.specialties AS specialties,
          f.source_urls AS source_urls,
          f.number_doctors AS number_doctors,
          f.capacity AS capacity,
          f.year_established AS year_established,
          f.official_phone AS official_phone,
          f.official_website AS official_website,
          t.trust_score AS trust_score,
          t.coverage_score AS coverage_score,
          t.hard_flags AS hard_flags
        FROM data_legend.silver.facilities f
        JOIN data_legend.gold.facility_trust t USING (facility_id)
        WHERE f.facility_id = :id
      `,
      [{ name: 'id', value: id }]
    );

    const facilityRow = facilityRows[0];
    if (!facilityRow) {
      return NextResponse.json({ error: 'Facility not found' }, { status: 404 });
    }

    const capabilityRows = await execSql(
      `
        SELECT
          capability AS capability,
          status AS status,
          evidence_sentence AS evidence_sentence,
          source_field AS source_field,
          grounded AS grounded
        FROM data_legend.silver.facility_capabilities
        WHERE facility_id = :id
        ORDER BY capability
      `,
      [{ name: 'id', value: id }]
    );

    const detail: FacilityDetail = {
      facility_id: String(facilityRow.facility_id),
      name: String(facilityRow.name),
      facility_type: facilityRow.facility_type == null ? null : String(facilityRow.facility_type),
      city: facilityRow.city == null ? null : String(facilityRow.city),
      state: facilityRow.state == null ? null : String(facilityRow.state),
      pincode: facilityRow.pincode == null ? null : String(facilityRow.pincode),
      description: facilityRow.description == null ? null : String(facilityRow.description),
      specialties: parseArrayColumn(facilityRow.specialties),
      source_urls: parseArrayColumn(facilityRow.source_urls),
      number_doctors: facilityRow.number_doctors == null ? null : Number(facilityRow.number_doctors),
      capacity: facilityRow.capacity == null ? null : Number(facilityRow.capacity),
      year_established: facilityRow.year_established == null ? null : Number(facilityRow.year_established),
      official_phone: facilityRow.official_phone == null ? null : String(facilityRow.official_phone),
      official_website: facilityRow.official_website == null ? null : String(facilityRow.official_website),
      trust_score: Number(facilityRow.trust_score),
      coverage_score: Number(facilityRow.coverage_score),
      hard_flags: parseHardFlags(facilityRow.hard_flags),
      capabilities: capabilityRows.map(row => ({
        capability: String(row.capability),
        status: row.status as 'yes' | 'no' | 'unclear',
        evidence_sentence: row.evidence_sentence == null ? null : String(row.evidence_sentence),
        source_field: row.source_field == null ? null : String(row.source_field),
        grounded: toBool(row.grounded),
      })),
    };

    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
