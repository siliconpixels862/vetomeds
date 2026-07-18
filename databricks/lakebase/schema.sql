-- Lakebase (Postgres 16) persistence schema — instance: data-legend-db
-- Track A (Facility Trust Desk): human-verified overrides, grain (facility, capability)
-- Track B (Medical Desert Planner): saved planning scenarios
-- Every row is attributed to the Databricks App user (app_user).

CREATE TABLE IF NOT EXISTS facility_overrides (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  capability TEXT,                      -- NULL = whole-facility note
  machine_status TEXT,                  -- snapshot at override time
  machine_score DOUBLE PRECISION,
  human_verdict TEXT CHECK (human_verdict IN ('yes','no','unclear')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_user, facility_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_overrides_facility ON facility_overrides (facility_id);

CREATE TABLE IF NOT EXISTS planning_scenarios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user TEXT NOT NULL,
  name TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT 'medical_desert_planner',
  capability TEXT,
  geo_level TEXT,                       -- state | district | pincode
  geo_value TEXT,
  filters_json JSONB,
  snapshot_json JSONB,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_user ON planning_scenarios (app_user);
