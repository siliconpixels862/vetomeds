# Data Legend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live Databricks App (Free Edition) that lets a non-technical planner (1) audit whether a facility can do what it claims with cited evidence and override the verdict, and (2) see trust-weighted medical/data deserts and save planning scenarios — both persisted in Lakebase.

**Architecture:** Reuse the 3rd-place `old-hackathon/` backend + Next.js frontend, re-targeted to the new DAIS-2026 dataset and re-deployed as a Databricks App. Data layer is Databricks SQL (medallion + `ai_query` extraction + 4-layer trust + Vector Search + PIN three-state aggregations). Persistence is Lakebase (Postgres). Frontend is Next.js (standalone Node) on Databricks Apps, talking to the SQL warehouse + Vector Search + Lakebase via the App's injected M2M identity.

**Tech Stack:** Databricks Free Edition (Unity Catalog, `ai_query` Llama 3.3 70B, Mosaic AI Vector Search, MLflow 3), Databricks Apps, Lakebase (Postgres), Next.js 15 (App Router, TypeScript), MapLibre GL.

## Global Constraints

- **Workspace:** Databricks Free Edition only, `dbc-652e144e-b1b3` (never a paid/enterprise workspace). Serverless Starter Warehouse.
- **Source tables (read-only, shared):** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.{facilities, india_post_pincode_directory, nfhs_5_district_health_indicators}`.
- **Build catalog:** `data_legend` with schemas `silver`, `gold`. Do NOT touch the old `vf_hackathon` catalog.
- **LLM endpoint:** `databricks-meta-llama-3-3-70b-instruct` (verified available). Embeddings: `databricks-gte-large-en` or `databricks-bge-large-en` (verify in Task 5).
- **21-capability taxonomy (fixed):** `icu, emergency_24x7, trauma_center, ambulance, general_surgery, cardiac_surgery, orthopedic_surgery, anesthesiology_staff, oncology, dialysis, cardiology, neurology, pediatrics, obstetrics_gynecology, neonatal_nicu, ct_scan, mri, ultrasound, pathology_lab, ventilator, oxygen_supply`. The 6 Facility-Trust-Desk-named caps (ICU, maternity=`obstetrics_gynecology`, emergency=`emergency_24x7`, oncology, trauma=`trauma_center`, NICU=`neonatal_nicu`) are first-class in the picker.
- **Two tracks only:** Facility Trust Desk (hero) + Medical Desert Planner.
- **Override model (Trust Desk):** human verdict LAYERS ON TOP — never overwrite machine reasoning. `effective_status = human_verdict if an override row exists else machine_status`. Human-verified rows show a distinct badge and re-rank.
- **Three-state desert (Planner):** per `(pincode, capability)` → `covered` (≥1 effective yes) / `medical_desert` (facilities present + data populated but none qualifies, or populated PIN w/ zero facilities per PIN directory) / `data_desert` (facilities present but relevant fields too sparse to judge). Never render sparse data as confirmed absence.
- **Persistence:** Lakebase (Postgres). Every user-action row tagged with the Databricks App identity (`app_user`).
- **Frontend deploy:** Next.js `output:'standalone'`; `app.yaml` → `command: ["node","server.js"]`; runtime auth via injected `DATABRICKS_CLIENT_ID/SECRET/HOST` (no PAT).
- **Prioritize by rubric:** Evidence&Trust 35% > Product Judgment 30% > Technical Execution 25% > Ambition 10%.
- **DEFERRED (do NOT build now, per user):** Git-repo submission packaging, 1-minute demo script/video, NFHS-5 demand overlay.

## Current State (already done — do not redo)

- ✅ `data_legend` catalog + `silver`/`gold` schemas created.
- ✅ `data_legend.silver.facilities` — 10,000 clean rows (`organization_type='facility'`), arrays parsed (`specialties, capability_facts, procedure_facts, equipment_facts, source_urls`), numerics cast, geo kept.
- ✅ `data_legend.silver.facilities_quarantine` — 88 malformed rows.
- ✅ Extraction approach validated on a 50-row pilot (Llama 3.3 70B, strict JSON, verbatim evidence).
- ⏳ `data_legend.silver.facility_capabilities_raw` — full 10k extraction RUNNING (statement `01f182e7-2298-...`). Task 1 resumes from its output.

---

## File Structure

```
new-hackathon/
  databricks/
    sql/            # numbered, idempotent SQL (port+adapt from old-hackathon/databricks/sql)
      01_capabilities_explode_ground.sql   # raw JSON -> exploded + evidence grounding
      02_medical_standards.sql             # ~30 NABH/WHO rules (validator reference)
      03_trust_scorer.sql                  # 4-layer, recalibrated
      04_text_chunks.sql                   # sentence chunks for vector search
      05_vector_index.py                   # create Mosaic AI Vector Search index (REST/SDK)
      06_pincode_three_state.sql           # gold.pincode_capability_gaps (3-state)
    lakebase/
      schema.sql                           # facility_overrides, planning_scenarios
    prompts/                               # extraction/validator prompts (verbatim, for repo)
  apps/web/         # Next.js (ported from old-hackathon/apps/web)
    app.yaml                               # Databricks Apps entrypoint
    src/lib/databricks/{sql.ts,vectorsearch.ts,lakebase.ts}
    src/lib/trustdesk/*                    # capability+region search, effective_status merge
    src/lib/desert/*                       # three-state fetch
    src/app/{trust-desk,desert}/page.tsx   # two track surfaces
    src/app/api/**                         # route handlers
```

---

## Phase 1 — Data layer (Databricks SQL, mostly free)

### Task 1: Explode + evidence-ground capabilities

**Files:** Create `databricks/sql/01_capabilities_explode_ground.sql`

**Interfaces:**
- Consumes: `data_legend.silver.facility_capabilities_raw(facility_id, name, facility_type, raw_json)` and `data_legend.silver.facilities`.
- Produces: `data_legend.silver.facility_capabilities(facility_id, capability, status, evidence_sentence, source_field, grounded BOOLEAN)` — one row per `(facility_id, capability)` with `status ∈ {yes,no,unclear}`.

- [ ] **Step 1: Confirm the full extraction finished.** Run: `SELECT COUNT(*) AS n, SUM(CASE WHEN raw_json IS NULL THEN 1 ELSE 0 END) AS nulls FROM data_legend.silver.facility_capabilities_raw`. Expected: `n=10000`. If the statement is still running, poll `01f182e7-2298-...`; if it errored/partial, re-run the extraction CTAS from the spec.

- [ ] **Step 2: Parse + explode.** Parse `raw_json` (shape `{"caps":[{"c","s","e","f"}]}`) with `from_json(raw_json,'struct<caps:array<struct<c:string,s:string,e:string,f:string>>>')`, `explode` the `caps` array. Normalize `f`: map `capabilities→capability`, `procedures→procedure`. Keep only `c` values in the 21-cap taxonomy (drop hallucinated cap names).

- [ ] **Step 3: Evidence grounding.** Join back to `facilities`. A `yes`/`unclear` row is `grounded=true` only if `lower(evidence_sentence)` is a substring of the concatenated source text (`description || capability_facts || procedure_facts || equipment_facts || array_join(specialties)`) OR (for `f='specialties'`) the evidence token is an element of `specialties`. Ungrounded `yes` → demoted to `unclear`. Record `grounded`.

- [ ] **Step 4: Densify to all 21 caps.** Left-join each facility × the 21-cap list; caps absent from the model output get `status='no', evidence_sentence=NULL`. Write `CREATE OR REPLACE TABLE data_legend.silver.facility_capabilities`.

- [ ] **Step 5: Acceptance.** Run: `SELECT capability, status, COUNT(*) FROM data_legend.silver.facility_capabilities GROUP BY 1,2 ORDER BY 1,2`. Expected: 21 caps × 3 statuses; `yes` counts plausible (hospitals dominate ICU/emergency); spot-check 10 rows have verbatim evidence. Report the grounding demotion rate.

### Task 2: Medical standards reference table

**Files:** Create `databricks/sql/02_medical_standards.sql`

**Interfaces:** Produces `data_legend.silver.medical_standards(rule_id, capability, requires, rationale)` — ~15 rules the Trust Scorer + validator reference (port from `old-hackathon/databricks/sql/04_medical_standards.sql`).

- [ ] **Step 1:** Port the old `medical_standards` seed rows; adapt capability names to this taxonomy. Include: surgery⇒anesthesiology_staff; icu⇒ventilator|oxygen_supply; oncology⇒`medicalOncology` specialty; dialysis⇒`nephrology`; neonatal_nicu⇒pediatrics|obstetrics; trauma_center⇒emergency_24x7.
- [ ] **Step 2: Acceptance.** `SELECT COUNT(*) FROM data_legend.silver.medical_standards` ≥ 12.

### Task 3: 4-layer Trust Scorer (recalibrated)

**Files:** Create `databricks/sql/03_trust_scorer.sql`

**Interfaces:**
- Consumes: `silver.facility_capabilities`, `silver.facilities`, `silver.medical_standards`.
- Produces: `data_legend.gold.facility_trust(facility_id, trust_score DOUBLE, hard_flags ARRAY<STRUCT<rule:STRING,penalty:DOUBLE>>, coverage_score DOUBLE, junk_corporate_flag INT, geo_outlier_flag INT)`.

- [ ] **Step 1: Layer 1 — hard rules (port `old-hackathon/databricks/sql/12_trust_scorer.sql`).** Use the controlled `specialties` for corroboration: surgery `yes` + no `anesthesia` in specialties → −0.20; icu `yes` + no ventilator/oxygen `yes` → −0.15; oncology `yes` + no `medicalOncology` → −0.15; dialysis `yes` + no `nephrology` → −0.10; capacity>50 & number_doctors NULL → −0.10; each `yes` with `grounded=false` → −0.10; description<30 chars → −0.05; neonatal_nicu `yes` + no pediatrics/obstetrics → −0.10; trauma_center `yes` + emergency_24x7≠yes → −0.10.
- [ ] **Step 2: Layer 2 — coverage_score.** Fraction of {description, capability, procedure, equipment, specialties, geo, pincode, contact} present. (Recalibrate: denser data than old — set the penalty weight so the histogram isn't collapsed.)
- [ ] **Step 3: Layer 3 — anomalies.** `junk_corporate_flag` via regex `LLPIN|\\bCIN\\b|Paid-up capital|Designated Partner|RoC|Active LLP` on description → force trust 0. `geo_outlier_flag` if lat/lng outside India bbox (6–38N, 68–98E).
- [ ] **Step 4: Layer 4 — validator pass (SELF-CORRECTION, stretch-worthy).** For a bounded subset first (e.g. facilities with ≥1 hard flag), one `ai_query` consistency check "given these claims + evidence, is there a contradiction? return {adjustment:-0.2..0.1, reason}". Average into score. Guard quota: run on flagged rows only, not all 10k.
- [ ] **Step 5: Combine + write.** `trust_score = clamp01(1.0 − Σpenalties + 0.15·coverage_score − (junk?1:0) + l4_adjustment)`. `CREATE OR REPLACE TABLE gold.facility_trust`.
- [ ] **Step 6: Acceptance.** Trust histogram spread across [0,1] (not one spike); junk rows at ~0; `SELECT COUNT(*) FROM gold.facility_trust WHERE junk_corporate_flag=1` matches the ~4.5% expectation on this data; spot-check 20 flagged rows.

### Task 4: Sentence chunks for retrieval

**Files:** Create `databricks/sql/04_text_chunks.sql`

**Interfaces:** Produces `data_legend.silver.facility_text_chunks(chunk_id, facility_id, sentence, source_field)` (sentence-split of description + each fact array element).

- [ ] **Step 1:** Explode `description` (split on `. `) + each element of `capability_facts/procedure_facts/equipment_facts` into one row per sentence, tagged with `source_field`. Enable Change Data Feed (`TBLPROPERTIES (delta.enableChangeDataFeed=true)`) — required by Vector Search.
- [ ] **Step 2: Acceptance.** `SELECT COUNT(*) FROM silver.facility_text_chunks` ≈ 30k–120k; every `facility_id` in `facilities` has ≥1 chunk (except empty-text rows).

### Task 5: Vector Search index

**Files:** Create `databricks/sql/05_vector_index.py` (Databricks notebook / Python)

**Interfaces:** Produces a Mosaic AI Vector Search index `data_legend.silver.facility_text_chunks_idx` (Delta-sync, embedding source `sentence`).

- [ ] **Step 1:** Verify Vector Search is enabled on Free Edition (`SHOW ... ` / UI). If not available, record the fallback: BM25-only via `ai_query`-free keyword search (Trust Desk still functions).
- [ ] **Step 2:** Create endpoint + Delta-sync index on `silver.facility_text_chunks` with `databricks-gte-large-en` (fallback `databricks-bge-large-en`).
- [ ] **Step 3: Acceptance.** A test similarity query ("dialysis unit") returns relevant sentences with facility_ids.

### Task 6: PIN three-state desert aggregation

**Files:** Create `databricks/sql/06_pincode_three_state.sql`

**Interfaces:**
- Consumes: `silver.facilities`, `silver.facility_capabilities`, `gold.facility_trust`, `india_post_pincode_directory`.
- Produces: `data_legend.gold.pincode_capability_gaps(pincode, capability, facilities_in_pin, yes_count, trust_weighted_yes, state DESC_STATE, district, coverage_score, desert_state STRING)` where `desert_state ∈ {covered, medical_desert, data_desert}`.

- [ ] **Step 1:** Aggregate `facility_capabilities` by `(pincode, capability)` with trust-weighting (exclude junk). `covered` = `yes_count≥1`. Among non-covered: `data_desert` if the facilities in that PIN mostly lack the relevant source fields for that capability (sparse), else `medical_desert`.
- [ ] **Step 2:** Left-join `india_post_pincode_directory` (dedup to PIN grain first — row grain is post office, cardinality fan-out risk) to add `district`/`state` and to mark populated PINs with zero facilities as `medical_desert`.
- [ ] **Step 3: Acceptance.** `SELECT capability, desert_state, COUNT(*) FROM gold.pincode_capability_gaps GROUP BY 1,2` shows all three states present per capability; no NULL `desert_state`.

---

## Phase 2 — Lakebase persistence

### Task 7: Provision Lakebase + schema

**Files:** Create `databricks/lakebase/schema.sql`

**Interfaces:** Produces Postgres tables `facility_overrides` and `planning_scenarios` (exact DDL below).

- [ ] **Step 1:** Create a Lakebase (Postgres) instance in the workspace (UI/CLI). Record host/db/credentials for the App env.
- [ ] **Step 2:** Apply DDL:
```sql
CREATE TABLE IF NOT EXISTS facility_overrides (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  capability TEXT,
  machine_status TEXT, machine_score DOUBLE PRECISION,
  human_verdict TEXT CHECK (human_verdict IN ('yes','no','unclear')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_user, facility_id, capability)
);
CREATE TABLE IF NOT EXISTS planning_scenarios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user TEXT NOT NULL, name TEXT NOT NULL,
  capability TEXT, geo_level TEXT, geo_value TEXT,
  filters_json JSONB, snapshot_json JSONB, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- [ ] **Step 3: Acceptance.** Insert + select a throwaway row in each table via `psql`/client; then delete it.

---

## Phase 3 — Next.js app on Databricks Apps (port + deploy smoke test)

### Task 8: Port app skeleton + standalone build

**Files:** Copy `old-hackathon/apps/web` → `new-hackathon/apps/web`; Modify `next.config.ts`; Create `apps/web/app.yaml`.

- [ ] **Step 1:** Copy the app. In `next.config.ts` set `output: 'standalone'`. Create `app.yaml`:
```yaml
command: ["node", "server.js"]
```
- [ ] **Step 2:** Delete Vercel-specific config (`vercel.json`, keepwarm cron assumptions). `pnpm install`; `pnpm build` locally to confirm standalone output.
- [ ] **Step 3: Acceptance.** `.next/standalone/server.js` exists; `node .next/standalone/server.js` serves the landing page locally.

### Task 9: Databricks clients (SQL + Vector + Lakebase) with M2M auth

**Files:** Create `apps/web/src/lib/databricks/{sql.ts,vectorsearch.ts,lakebase.ts}` (adapt old `sql.ts`/`vectorsearch.ts`).

**Interfaces:**
- Produces: `execSql(query, params): Promise<Row[]>` (SQL warehouse via injected M2M creds); `vectorSearch(text, k): Promise<Hit[]>`; `lakebase(): pg.Pool`.

- [ ] **Step 1:** Replace PAT auth with injected `DATABRICKS_CLIENT_ID/SECRET/HOST` → mint an M2M OAuth token; point `sql.ts` at the Serverless Starter Warehouse `/api/2.0/sql/statements`.
- [ ] **Step 2:** `lakebase.ts` — a `pg.Pool` from Lakebase env vars.
- [ ] **Step 3: Test (TDD).** Write `sql.test.ts` asserting `execSql('SELECT 1 AS x')` returns `[{x:1}]` (mock the fetch). Run vitest → pass.

### Task 10: Deploy smoke test (DE-RISK GATE)

- [ ] **Step 1:** `databricks bundle deploy` + `databricks app start` the skeleton with one page that (a) runs `SELECT COUNT(*) FROM data_legend.silver.facilities` and (b) writes+reads one throwaway `facility_overrides` row.
- [ ] **Step 2: Acceptance.** The live Databricks App URL renders `10000` and the round-tripped override. **If this fails on Free Edition, STOP and switch the frontend to Streamlit over the same backend (fallback in the spec) before continuing.**

---

## Phase 4 — Facility Trust Desk (hero track)

### Task 11: Ranked facilities API (capability + region)

**Files:** Create `apps/web/src/lib/trustdesk/search.ts`, `apps/web/src/app/api/trust-desk/route.ts`. Reuse `old-hackathon/apps/web/src/lib/search/*` (prefilter, scoring, RRF) adapted to structured input.

**Interfaces:** Produces `POST /api/trust-desk {capability, state?, district?, pincode?}` → `{facilities: [{facility_id, name, city, state, trust_score, effective_status, top_evidence[], distance?}]}` ranked by trust×effective_status.

- [ ] **Step 1: Test (TDD).** `search.test.ts`: given a fake capability+region, the SQL builder emits a query filtering `facility_capabilities.capability = ? AND status IN ('yes','unclear')` joined to `facility_trust` and location. Assert query shape.
- [ ] **Step 2:** Implement `buildTrustDeskQuery()` + `effectiveStatus()` merge (see Task 13).
- [ ] **Step 3:** Route handler returns ranked list. Human-verified `yes` sort above machine `yes`.
- [ ] **Step 4: Acceptance.** Live call for `{capability:'icu', state:'Maharashtra'}` returns ranked hospitals with trust + evidence.

### Task 12: Facility detail with citations

**Files:** Reuse/adapt `old-hackathon/apps/web/src/app/facility/[id]/page.tsx` + `EvidenceCitation.tsx`, `TrustBadge.tsx`.

- [ ] **Step 1:** Detail page shows per-capability `status`, `evidence_sentence`, `source_field`, and **`source_urls`** (clickable provenance), plus the trust `hard_flags` breakdown.
- [ ] **Step 2: Acceptance.** Opening a facility shows every extracted capability with its verbatim evidence and at least one source URL.

### Task 13: Override-with-note (human-verified layer) + persist

**Files:** Create `apps/web/src/lib/trustdesk/effective_status.ts`, `apps/web/src/app/api/overrides/route.ts`; Modify facility detail to add the override control.

**Interfaces:**
- Produces: `effectiveStatus(machine, override?): {status, verified: boolean, by?, note?}`; `POST/GET/PATCH /api/overrides`.

- [ ] **Step 1: Test (TDD) — the core rule.** `effective_status.test.ts`:
```ts
expect(effectiveStatus({status:'yes'}, undefined)).toEqual({status:'yes', verified:false});
expect(effectiveStatus({status:'yes'}, {human_verdict:'no', app_user:'u', note:'called'}))
  .toEqual({status:'no', verified:true, by:'u', note:'called'});
```
- [ ] **Step 2:** Implement `effectiveStatus` (override wins iff present; machine reasoning preserved separately).
- [ ] **Step 3:** `POST /api/overrides` upserts into Lakebase `facility_overrides` (unique on `app_user,facility_id,capability`), tagging `app_user` from the App identity, snapshotting `machine_status`/`machine_score`.
- [ ] **Step 4:** Detail UI: a control to set verdict + note; on save, show the `Human-verified: <verdict> — <user>, <date>` banner ABOVE the still-visible machine reasoning; results re-rank.
- [ ] **Step 5: Acceptance (end-to-end).** Override ICU→no on a facility, reload → banner persists, facility re-ranks below machine-yes, machine evidence still shown.

---

## Phase 5 — Medical Desert Planner

### Task 14: Three-state desert API

**Files:** Create `apps/web/src/lib/desert/fetch.ts`, `apps/web/src/app/api/desert/route.ts` (adapt old `/api/desert`).

**Interfaces:** `GET /api/desert?capability=&geo_level=&geo_value=` → `{cells:[{pincode, district, desert_state, coverage_score, yes_count, facilities_in_pin}]}` from `gold.pincode_capability_gaps`, override-aware.

- [ ] **Step 1: Test (TDD).** Given fake rows, `classifyCell()` returns `covered|medical_desert|data_desert` per the Global-Constraints definition. Assert all three branches.
- [ ] **Step 2:** Route reads `pincode_capability_gaps` filtered by capability+geo; merges live overrides so a human-verified `yes` flips a cell to `covered`.
- [ ] **Step 3: Acceptance.** `?capability=dialysis&geo_level=state&geo_value=Bihar` returns cells spanning all three states.

### Task 15: Choropleth + drill-through + save scenario

**Files:** Reuse `old-hackathon/apps/web/src/components/ChoroplethMap.tsx` + `/explore/page.tsx` → `apps/web/src/app/desert/page.tsx`; Create `apps/web/src/app/api/scenarios/route.ts`.

- [ ] **Step 1:** Render the map with **three** legend states (green/red/gray), not two. Capability + geography pickers.
- [ ] **Step 2:** Click a cell → drill into the facility records behind it (links to Task 12 detail).
- [ ] **Step 3:** "Save scenario" → `POST /api/scenarios` persists `{name, capability, geo_level, geo_value, filters, snapshot}` to Lakebase, tagged `app_user`; a "My scenarios" list reloads them.
- [ ] **Step 4: Acceptance (end-to-end).** Save a "Dialysis gaps in Bihar" scenario, reload the app → it reappears and restores the map state.

---

## Phase 6 — Trust/honesty polish + MLflow tracing (Ambition)

### Task 16: Honesty states + MLflow traceability

- [ ] **Step 1:** Wire the abstain / "no confident match" and **data-desert vs medical-desert** copy so the UI never presents sparse data as confirmed absence.
- [ ] **Step 2:** Enable MLflow 3 tracing on the extraction + validator `ai_query` runs; surface a trace link on the facility detail (stretch).
- [ ] **Step 3:** Data Readiness surface (Ambition, multi-track): a read-only page listing `silver.facilities_quarantine` + high-flag facilities from `facility_trust`.
- [ ] **Step 4: Acceptance.** Demo path hits both tracks + at least one honesty state; MLflow shows traces.

---

## Deferred (explicitly out of scope for now)

- Git-repo submission packaging (repo already inits locally; push later).
- 1-minute demo script/video.
- NFHS-5 demand overlay (`nfhs_5_district_health_indicators`) — stretch after both tracks are airtight.

---

## Self-Review

**Spec coverage:** Evidence Engine → Tasks 1,4,5,12. Trust Scorer → Tasks 2,3,13. Planner's Workflow (persist) → Tasks 7,13,15. Facility Trust Desk → Tasks 11–13. Medical Desert Planner → Tasks 14–15. Data-desert-vs-medical-desert → Tasks 6,14,16. Live Databricks App → Tasks 8–10. Lakebase → Tasks 7,13,15. Stretch (MLflow/validator/crisis map) → Tasks 3(L4),6,16. All rubric buckets covered.

**Gaps intentionally deferred:** submission packaging, demo, NFHS-5 (per user).

**Type consistency:** `effectiveStatus` signature identical in Tasks 11/13/14; `desert_state` enum identical in Tasks 6/14/15; `facility_capabilities` columns identical in Tasks 1/3/6/11.
