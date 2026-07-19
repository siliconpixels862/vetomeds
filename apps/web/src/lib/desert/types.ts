export interface DesertCell {
  pincode: string;
  district: string | null;
  state: string | null;
  desert_state: 'covered' | 'medical_desert' | 'data_desert';
  facilities_in_pin: number;
  yes_count: number;
  unclear_count: number;
  trust_weighted_yes: number;
  avg_coverage: number;
  lat: number | null;
  lng: number | null;
}

export interface DesertSummary {
  covered: number;
  medical_desert: number;
  data_desert: number;
}

export interface Scenario {
  id: number;
  app_user: string;
  name: string;
  track: string | null;
  capability: string | null;
  geo_level: string | null;
  geo_value: string | null;
  filters_json: unknown;
  snapshot_json: unknown;
  note: string | null;
  created_at: string;
}

/** The three geo levels the desert query can filter by; the value selects a column name, never interpolated. */
export const GEO_LEVELS = ['state', 'district', 'pincode'] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];
