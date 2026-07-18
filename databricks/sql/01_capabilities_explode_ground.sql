-- 01_capabilities_explode_ground.sql
-- Parse the raw LLM extraction JSON, explode to one row per (facility, capability),
-- apply evidence grounding (demote ungrounded 'yes' -> 'unclear'), and densify to
-- all 21 capabilities x 10,000 facilities (missing caps => 'no').
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE TABLE data_legend.silver.facility_capabilities AS
WITH caps21 AS (
  SELECT explode(array(
    'icu','emergency_24x7','trauma_center','ambulance','general_surgery','cardiac_surgery',
    'orthopedic_surgery','anesthesiology_staff','oncology','dialysis','cardiology','neurology',
    'pediatrics','obstetrics_gynecology','neonatal_nicu','ct_scan','mri','ultrasound',
    'pathology_lab','ventilator','oxygen_supply')) AS capability
),
parsed AS (
  SELECT facility_id,
         from_json(raw_json, 'struct<caps:array<struct<c:string,s:string,e:string,f:string>>>') AS j
  FROM data_legend.silver.facility_capabilities_raw
),
exploded AS (
  SELECT p.facility_id,
         lower(cap.c) AS capability,
         lower(cap.s) AS raw_status,
         cap.e AS evidence_sentence,
         CASE lower(cap.f)
           WHEN 'capabilities' THEN 'capability'
           WHEN 'procedures'   THEN 'procedure'
           WHEN 'specialty'    THEN 'specialties'
           ELSE lower(cap.f)
         END AS source_field
  FROM parsed p
  LATERAL VIEW explode(p.j.caps) t AS cap
),
valid AS (
  SELECT e.* FROM exploded e
  JOIN caps21 c ON e.capability = c.capability
  WHERE e.raw_status IN ('yes','unclear')
),
grounded AS (
  SELECT v.facility_id, v.capability, v.evidence_sentence, v.source_field, v.raw_status,
         lower(concat_ws(' ',
           f.description,
           array_join(f.capability_facts, ' '),
           array_join(f.procedure_facts,  ' '),
           array_join(f.equipment_facts,  ' '),
           array_join(f.specialties,       ' '))) AS src
  FROM valid v
  JOIN data_legend.silver.facilities f USING (facility_id)
),
scored AS (
  SELECT facility_id, capability, evidence_sentence, source_field, raw_status,
         (evidence_sentence IS NOT NULL
          AND length(trim(evidence_sentence)) > 0
          AND contains(src, lower(trim(evidence_sentence)))) AS grounded
  FROM grounded
),
final_status AS (
  SELECT facility_id, capability,
         CASE WHEN raw_status = 'yes' AND NOT grounded THEN 'unclear' ELSE raw_status END AS status,
         evidence_sentence, source_field, grounded
  FROM scored
),
ranked AS (
  SELECT *,
         row_number() OVER (
           PARTITION BY facility_id, capability
           ORDER BY CASE status WHEN 'yes' THEN 0 ELSE 1 END,
                    CASE WHEN grounded THEN 0 ELSE 1 END
         ) AS rn
  FROM final_status
),
best AS (SELECT * FROM ranked WHERE rn = 1)
SELECT
  f.facility_id,
  c.capability,
  COALESCE(b.status, 'no')        AS status,
  b.evidence_sentence,
  b.source_field,
  COALESCE(b.grounded, false)      AS grounded
FROM data_legend.silver.facilities f
CROSS JOIN caps21 c
LEFT JOIN best b
  ON b.facility_id = f.facility_id AND b.capability = c.capability;
