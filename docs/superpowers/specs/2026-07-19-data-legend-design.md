# Design Spec — Data Legend: Trust Layer for Indian Healthcare

> **Date:** 2026-07-19
> **Challenge:** Hack-Nation × Databricks "Data Legend / Serving A Nation" (Challenge 04), 6th Global AI Hackathon
> **Source brief:** `new-hack-requiremnts-doc.pdf`
> **Prior art:** `old-hackathon/` — the 3rd-place "Agentic Healthcare Intelligence System" (Challenge 03). This build **reuses its backend and frontend**, re-targeted to the new dataset, the new deliverable (Databricks App), and persistence.
> **Status:** Drafted autonomously (user directive "do everything yourself"). Open for review.

---

## 1. Goal

Ship a **live Databricks App on Free Edition** that turns 10,000 messy Indian facility records into decisions a non-technical NGO/public-health planner can trust, defend, and save. We build **two of the four mission tracks**, chosen for maximum reuse of the prior 3rd-place build and maximum alignment with the "Trust Layer" theme:

1. **Facility Trust Desk (hero)** — "Can this facility actually do what it claims?" Pick a capability + region → ranked facilities with trust signals → expand to inspect citations → **override the assessment with a note** (human-verified, persisted).
2. **Medical Desert Planner** — "Where are the highest-risk gaps, and how confident are we?" Pick a capability + geography → **three-state** trust-weighted coverage (covered / medical desert / data desert) → drill into records → **save a planning scenario** (persisted).

The single biggest new obligations vs the prior build: **(a) deploy as a Databricks App** (not Vercel) and **(b) persist user actions via Lakebase**. Everything else — extraction, evidence grounding, 4-layer trust scorer, two-agent verification, hybrid search, PIN aggregations, the polished Next.js UI — ports forward.

### Hard constraint
The build MUST use the **NEW 51-column India 10k dataset** (the FDR "Foundational Data Refresh"). The old 41-column CSV is reference/proxy ONLY, never a build source. The new dataset is login-gated (Databricks account); acquiring + loading it is **Phase 0** and gates all downstream work.

---

## 2. Scope

### In scope (MVP)
- Data-layer rebuild on the new dataset: bronze → silver (cleaned + capability extraction w/ evidence grounding + text chunks + vector index) → gold (4-layer trust + PIN three-state aggregations).
- Facility Trust Desk end-to-end, including the **human-verified override layer** persisted in Lakebase.
- Medical Desert Planner end-to-end, including the **three-state desert map** and **saved scenarios** persisted in Lakebase.
- Port the Next.js frontend to a live Databricks App (standalone Node), auth via Databricks App M2M identity.
- MLflow 3 tracing on agent/extraction runs.

### Stretch (only after both tracks are airtight)
- NFHS-5 demand overlay ("high disease burden + low coverage" district ranking).
- Multi-track integration surfacing (e.g., a Referral-Copilot-style saved shortlist, `/audit` Data-Readiness view) for the Ambition (10%) criterion.
- Prediction-interval / confidence-band treatment for the desert map.
- MLflow trace tree surfaced in the facility detail UI.

### Out of scope
- Referral Copilot and Data Readiness Desk as *full* tracks (their read-only surfaces may be re-enabled for Ambition, not built to minimum-workflow depth).
- Multilingual support, external LLM APIs, cross-source registry verification, user auth beyond the Databricks App identity, ground-truth labeling.

---

## 3. Users

| Persona | Primary track | Need |
|---|---|---|
| NGO / public-health planner | Both | "Which facilities can I trust for capability X in region Y, and where are the real gaps?" |
| Field reviewer / verifier | Facility Trust Desk | "Record what I learned when I called/visited, so the team benefits." |

Single product, Databricks-App-authenticated. The logged-in Databricks user is the persistence identity — no separate auth system.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Databricks App (Free Edition)  — replaces Vercel             │
│  Ported Next.js (output:'standalone', node server.js)         │
│   Surfaces:                                                    │
│     /find + /facility/[id]   → Facility Trust Desk            │
│     /explore                 → Medical Desert Planner         │
│   Route Handlers (server-side):                               │
│     ├─ auth: Databricks M2M (auto-injected CLIENT_ID/SECRET)  │
│     ├─ reads  → SQL Warehouse, Vector Search, MLflow (REST)   │
│     └─ writes → Lakebase (node pg client)          — NEW      │
└───────────────┬──────────────────────────────┬───────────────┘
                │ Databricks REST (runtime)     │ Postgres wire
┌───────────────▼──────────────┐   ┌────────────▼──────────────┐
│  Unity Catalog (rebuilt on   │   │  Lakebase (managed PG) NEW │
│  the NEW dataset)            │   │  facility_overrides         │
│  bronze / silver / gold      │   │  planning_scenarios         │
│  ai_query · Vector Search    │   │  (rows tagged w/ app_user)  │
│  4-layer trust scorer        │   └────────────────────────────┘
└──────────────────────────────┘
```

**Auth change:** the old app held a Vercel PAT. The Databricks App auto-injects `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` / `DATABRICKS_HOST`; Route Handlers mint M2M tokens from those to reach the warehouse / Vector Search / MLflow, and connect to Lakebase over the Postgres wire protocol.

---

## 5. Data layer (new 51-column dataset, schema-adaptive)

### 5.1 Column mapping (adaptivity)
Because the exact 51 column names aren't confirmed until the file lands, ingestion resolves **logical fields → physical columns** via a single mapping config, validated at load:

| Logical field | Expected physical (from brief + proxy) | Coverage (brief) | Role |
|---|---|---|---|
| `name`, `facility_type`, `operator_type` | name, facilityTypeId, operatorTypeId | high | identity |
| `description` | description | 100% | claim/evidence |
| `capability` | capability | 99.7% | claim/evidence (noisy free-text array) |
| `procedure` | procedure | 92.5% | claim/evidence |
| `equipment` | equipment | 77.0% | claim/evidence |
| `specialties` | specialties | ~100% (clean) | **structured filter + corroboration** |
| `source_urls` | source_urls | — | **provenance / citation** (NEW vs old schema) |
| `number_doctors`, `capacity`, `year_established` | numberDoctors, capacity, yearEstablished | 36.4 / 25.2 / 47.8% | numeric signals |
| `state`, `city`, `pincode` | address_stateOrRegion, address_city, address_zipOrPostcode | pincode 99.96% | geography (dirty names) |
| `lat`, `lng` | latitude, longitude | high | geo join |

Load fails loudly if a required logical field can't be mapped. Literal `"null"` / `"[]"` strings are normalized to SQL NULL at bronze→silver (confirmed gotcha from proxy inspection).

**Authoritative schema (from the VF starter materials, `data/starter_materials/`):** the dataset is produced by the `Facility` pydantic model (`facility_and_ngo_fields.py`) + `FacilityFacts` (`free_form.py`) + `MedicalSpecialties` (`medical_specialties.py`). Confirmed semantics:
- `facilityTypeId ∈ {hospital, pharmacy, doctor, clinic, dentist}`; `operatorTypeId ∈ {public, private}`; `affiliationTypeIds ⊂ {faith-tradition, philanthropy-legacy, community, academic, government}`.
- `capability`, `procedure`, `equipment` are free-text `list[str]`; **`capability` is already semi-structured** (e.g. `"Level III NICU"`, `"24/7 emergency care"`, `"Joint Commission accredited"`) — our taxonomy extraction maps these, and every fact is pipeline-guaranteed traceable to source text.
- `specialties` is a **controlled camelCase vocabulary** (`MEDICAL_HIERATCHY`). Relevant mappings: trauma→`criticalCareMedicine`, oncology→`medicalOncology`, NICU→`neonatologyPerinatalMedicine`, maternity→`gynecologyAndObstetrics`, dialysis→`nephrology`, and **`anesthesia`** is a first-class specialty.
- New fields vs old 41-col: `area` (floor m²), `acceptsVolunteers`, `logo`, NGO fields (`countries`, `missionStatement`, …). `source_urls` is referenced by the brief/Marketplace but NOT in the base schema doc → treat as FDR-added; confirm on load.

### 5.2 Medallion pipeline (ported, re-run on new data)
- **Source** — read directly from the shared Unity Catalog table `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities` (already Delta; **no Volume/CSV import needed**). Verified: **10,088 rows = 10,000 clean `organization_type='facility'` + ~88 malformed** (unescaped free-text delimiters shifted columns at source ingestion — `source_urls`/coordinate JSON/hashes leak into `facilityTypeId`). Real coverage matches the brief; `source_urls` 98.8%; `latitude`/`longitude` clean DOUBLE; facility mix is hospital-heavy (hospital 56%, clinic 38%). The `india_post_pincode_directory` and `nfhs_5_district_health_indicators` supplementals are **bundled in the same shared catalog** — no separate download.
- **silver.facilities** — filter to `organization_type='facility'` AND `facilityTypeId ∈ {hospital, clinic, dentist, doctor, pharmacy, nursing_home}`; **quarantine** the ~88 malformed rows to `silver.facilities_quarantine` (a Data-Readiness signal, surfaced honestly — not dropped silently); `"null"`/`"[]"` → NULL; parse `specialties`/`procedure`/`equipment`/`capability` JSON arrays; keep `unique_id` (PK), `cluster_id` (dedup), geography for PIN join.
- **silver.facility_capabilities** — `ai_query` (Llama 3.3 70B) extraction into the 21-capability taxonomy, 3-state (`yes`/`no`/`unclear`) with `evidence_sentence`, `source_field`, `confidence`. **Evidence-grounding filter** retained: a `yes` whose evidence isn't a verbatim substring of source text is demoted to `unclear`.
- **silver.facility_text_chunks** — sentence-level chunks; **Mosaic AI Vector Search** index (`databricks-bge-large-en`).
- **gold.facility_trust** — 4-layer scorer (below), **recalibrated** for the denser data.
- **gold.pincode_capability_gaps** — extended with the three-state classification (§7).

### 5.3 Trust scorer — recalibrate, don't redesign
Keep the 4 layers: (1) ~12 hard SQL penalty rules, (2) coverage score, (3) anomaly flags (junk-corporate ~4.5% in proxy, geo-outlier, short-desc), (4) two-agent validator dataset pass. **Recalibration needed** because the new data is far denser (equipment 16%→77%, capacity 1%→25%): coverage-based penalties and the desert cutoffs were tuned for sparse data and will over/under-fire otherwise. Exploit the controlled `specialties` vocabulary as concrete corroboration: surgery `procedure` + no `anesthesia` specialty ⇒ penalty (old rule p1); oncology capability + `medicalOncology` ⇒ confirmed; ICU/NICU + `criticalCareMedicine`/`neonatologyPerinatalMedicine` ⇒ confirmed; dialysis + `nephrology` ⇒ confirmed. Thresholds are set against **real** coverage histograms once the dataset loads.

---

## 6. Track A — Facility Trust Desk (hero)

### 6.1 Workflow
1. Planner selects **capability** (dropdown; the 6 named caps first-class) + **region** (state → district → PIN cascade, normalized via the PIN directory).
2. App shows **ranked facilities with trust signals** (reuse the 5-stage search + two-agent rerank; here the "query" is structured cap+region rather than free text).
3. Expand a facility → **facility detail** with per-capability status, `evidence_sentence`, `source_urls`, trust breakdown, and (stretch) MLflow trace.
4. Planner **overrides the assessment**: sets a human verdict (`yes`/`no`/`unclear`) for `(facility, capability)` + a note. Persisted to Lakebase, attributed to the user.

### 6.2 Human-verified layer (the core product decision)
An override **layers on top of** the machine assessment; it never erases machine reasoning ("shows its receipts").

- **Display:** machine score + citations stay visible; a distinct banner shows `Human-verified: <verdict> — <user>, <date>` + note.
- **Effective status** used for ranking/desert math:
  `effective_status = human_verdict if an override exists else machine_status`.
- **Ranking:** human-verified `yes` outrank machine `yes`; human-verified `no` drop below machine `unclear`. A `verified` badge is a positive trust signal.
- **Persistence & recall:** overrides survive sessions and are visible team-wide; re-opening the facility shows the prior verdict.

This single feature scores across Evidence & Trust (35%, the ultimate "double-check"), Product Judgment (30%, closes a real loop), and the "remembers what humans learned" narrative.

---

## 7. Track B — Medical Desert Planner

### 7.1 Three-state classification (per `pincode × capability`)
- 🟢 **Covered** — ≥1 facility with `effective_status = yes` (evidence-grounded, override-aware).
- 🔴 **Medical desert ("no hospitals here")** — confident absence: facilities exist with the relevant fields populated but none qualifies, **or** the PIN directory shows a populated PIN with zero medical facilities.
- ⚪ **Data desert ("we don't know what's here")** — facilities may exist but the relevant fields are too sparse/`unclear` to judge. The honest-uncertainty state the brief explicitly rewards.

The **PIN directory** distinguishes "populated place, no facility" (real desert) from "no data," and cleans PIN→district/state joins (facility place-names are dirty — 194 distinct "states" in proxy).

### 7.2 Workflow
1. Select capability + geography (state / district / PIN).
2. Choropleth + table render the three states, trust-weighted.
3. Drill into an aggregate → the facility records behind it (links into Track A detail).
4. **Save a planning scenario** (filters + snapshot + note) → Lakebase, attributed to user, reloadable.

### 7.3 Stretch — NFHS-5 overlay
Point-in-polygon join facilities to districts; overlay NFHS-5 disease burden to rank "high burden + low coverage" districts. `*` values → NULL. Spatial join, not name match.

---

## 8. Lakebase persistence schema

```sql
-- Track A: human-verified overrides, grain = (facility, capability)
CREATE TABLE facility_overrides (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user      TEXT NOT NULL,               -- Databricks App identity
  facility_id   TEXT NOT NULL,
  capability    TEXT,                         -- NULL = whole-facility note
  machine_status TEXT,                        -- snapshot at override time
  machine_score  DOUBLE PRECISION,
  human_verdict TEXT CHECK (human_verdict IN ('yes','no','unclear')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_user, facility_id, capability)
);

-- Track B: saved planning scenarios
CREATE TABLE planning_scenarios (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user    TEXT NOT NULL,
  name        TEXT NOT NULL,
  track       TEXT NOT NULL DEFAULT 'medical_desert_planner',
  capability  TEXT,
  geo_level   TEXT,                           -- state|district|pincode
  geo_value   TEXT,
  filters_json JSONB,                         -- full filter state
  snapshot_json JSONB,                        -- aggregate results at save time
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Route Handlers expose `GET/POST/PATCH` for each; reads join overrides back into the search/desert results so `effective_status` reflects human verdicts everywhere.

---

## 9. Deployment (Databricks Apps)

- **Day-1 smoke test (de-risk):** deploy a hello-world Next.js (`output:'standalone'`, `app.yaml: command:["node","server.js"]`) + a Lakebase read/write to the Databricks App **before** porting real code. If it fails on Free Edition, fall back to a Streamlit shell over the same backend.
- Build locally (`next build`) → deploy `.next/standalone` via `databricks bundle deploy` + `databricks app start`.
- Auth: swap the Vercel PAT for auto-injected M2M creds; add a node Postgres client for Lakebase.
- Known frictions: 5–10 min deploys (file-copy), use middleware not `next.config` rewrites.
- **Submission:** Git repo + live Databricks App + 1-minute demo.

---

## 10. Reuse map (old-hackathon → this build)

| New need | Prior asset | Action |
|---|---|---|
| Ranking + evidence | `apps/web/src/lib/search/*` (5-stage + two-agent) | Reuse; feed structured cap+region |
| Facility detail | `/facility/[id]` | Reuse; add override UI + source_urls |
| Trust signals | `12_trust_scorer.sql` (4-layer) | Reuse; recalibrate on new data |
| Desert map | `/explore` + `13_pincode_aggregations.sql` | Reuse; add three-state logic |
| Extraction | `databricks/prompts/*`, `01*_extraction*.sql` | Reuse; remap to new columns |
| Persistence | — | **New** (Lakebase + endpoints) |
| Deploy | Vercel | **Replace** with Databricks Apps |

---

## 11. Error handling / honesty boundaries
- Abstain when top match < threshold ("no confident match — call ahead").
- Two-agent disagreement surfaced, never silently resolved.
- **Data desert ≠ medical desert** — never render sparse data as confirmed absence.
- Overrides never overwrite machine reasoning; both shown.
- Cold-start keep-warm ping; Vector Search 503 → BM25 fallback; `ai_query` quota → structured/keyword fallback with a UI warning.

## 12. Testing
- Port the existing `vitest` unit tests for the search pipeline (typo, ontology, RRF, fusion, abstain, scoring).
- New tests: column-mapping validation; `effective_status` override merge; three-state classification given synthetic coverage fixtures; Lakebase endpoint round-trips.
- Data checks: extraction spot-check (50 rows), trust histogram sanity, junk-flag rate, desert-state distribution sanity.

## 13. Build phases
- **Phase 0 (hard gate):** acquire + load the NEW dataset → `bronze.facilities_raw`; confirm real 51-col schema; freeze the column-mapping config. *No downstream work starts until this passes.*
- **Phase 1:** Databricks Apps + Lakebase smoke test (deploy hello-world + persist a row).
- **Phase 2:** silver pipeline — clean, extract (recalibrated), ground, chunk, vector index.
- **Phase 3:** gold — recalibrated 4-layer trust; PIN three-state aggregations.
- **Phase 4:** Port frontend to the App; wire structured cap+region search.
- **Phase 5:** Track A — facility detail + human-verified override + Lakebase.
- **Phase 6:** Track B — three-state desert map + saved scenarios + Lakebase.
- **Phase 7:** MLflow tracing, honesty/error states, demo polish, 1-min demo script.
- **Phase 8 (stretch):** NFHS-5 overlay; multi-track Ambition surfaces.

## 14. Rubric mapping
| Criterion | Weight | Where we score |
|---|---|---|
| Evidence & Trust | 35% | Evidence grounding + `source_urls` citations + 4-layer trust + two-agent verify + human-verified overrides + data-vs-medical desert honesty |
| Product Judgment | 30% | Two clean planner workflows; persisted overrides/scenarios; non-technical journey; not a chatbox |
| Technical Execution | 25% | Live Databricks App on Free Edition; Apps + Vector Search + Lakebase + serverless used well |
| Ambition | 10% | Multi-track integration; NFHS-5 overlay; confidence bands; MLflow trace surfacing |

## 15. Risks
| Risk | Mitigation |
|---|---|
| Dataset acquisition (Phase 0) | User downloads to `new-hackathon/`; hard gate before build |
| Next.js on Free-Edition Apps | Day-1 smoke test; Streamlit fallback |
| Trust/desert thresholds wrong on denser data | Recalibrate against real coverage histograms in Phase 2/3 |
| Exact 51-col names unknown now | Schema-adaptive column mapping, validated at load |
| Free Edition `ai_query`/Vector quota | Batch + retry; BM25/keyword fallbacks |

## 16. References
- New brief: `new-hack-requiremnts-doc.pdf`; datasets: `Datasets_Links`
- Prior build: `old-hackathon/` (design `docs/superpowers/specs/2026-04-26-agentic-healthcare-india-design.md`, `searchAlgorithm.md`, `MVP.md`)
- Databricks Apps (Node/Next.js standalone), Lakebase, Mosaic AI Vector Search, MLflow 3
