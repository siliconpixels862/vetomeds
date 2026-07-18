-- 03_trust_scorer.sql
-- gold.facility_trust: Layer 1 hard rules (with specialties corroboration) +
-- Layer 2 coverage + Layer 3 anomalies. Layer 4 (ai_query validator on flagged
-- rows) is applied by 03b (optional, quota-gated). trust_score in [0,1].

CREATE OR REPLACE TABLE data_legend.gold.facility_trust AS
WITH cap AS (
  SELECT facility_id,
    MAX(CASE WHEN capability='icu'                  AND status='yes' THEN 1 ELSE 0 END) AS icu,
    MAX(CASE WHEN capability='ventilator'           AND status='yes' THEN 1 ELSE 0 END) AS ventilator,
    MAX(CASE WHEN capability='oxygen_supply'        AND status='yes' THEN 1 ELSE 0 END) AS oxygen,
    MAX(CASE WHEN capability='general_surgery'      AND status='yes' THEN 1 ELSE 0 END) AS gensurg,
    MAX(CASE WHEN capability='cardiac_surgery'      AND status='yes' THEN 1 ELSE 0 END) AS cardsurg,
    MAX(CASE WHEN capability='orthopedic_surgery'   AND status='yes' THEN 1 ELSE 0 END) AS orthosurg,
    MAX(CASE WHEN capability='anesthesiology_staff' AND status='yes' THEN 1 ELSE 0 END) AS anes,
    MAX(CASE WHEN capability='oncology'             AND status='yes' THEN 1 ELSE 0 END) AS oncology,
    MAX(CASE WHEN capability='dialysis'             AND status='yes' THEN 1 ELSE 0 END) AS dialysis,
    MAX(CASE WHEN capability='neonatal_nicu'        AND status='yes' THEN 1 ELSE 0 END) AS nicu,
    MAX(CASE WHEN capability='pediatrics'           AND status='yes' THEN 1 ELSE 0 END) AS peds,
    MAX(CASE WHEN capability='obstetrics_gynecology' AND status='yes' THEN 1 ELSE 0 END) AS obg,
    MAX(CASE WHEN capability='trauma_center'        AND status='yes' THEN 1 ELSE 0 END) AS trauma,
    MAX(CASE WHEN capability='emergency_24x7'       AND status='yes' THEN 1 ELSE 0 END) AS emergency,
    SUM(CASE WHEN status='yes' AND NOT grounded THEN 1 ELSE 0 END) AS ungrounded_yes
  FROM data_legend.silver.facility_capabilities
  GROUP BY facility_id
),
spec AS (
  SELECT facility_id,
    array_contains(transform(coalesce(specialties, array()), x -> lower(x)), 'medicaloncology') AS has_onc_spec,
    array_contains(transform(coalesce(specialties, array()), x -> lower(x)), 'nephrology')      AS has_neph_spec,
    array_contains(transform(coalesce(specialties, array()), x -> lower(x)), 'anesthesia')      AS has_anes_spec
  FROM data_legend.silver.facilities
),
base AS (
  SELECT f.facility_id, f.name, f.facility_type, f.description, f.number_doctors, f.capacity,
         f.latitude, f.longitude, f.pincode, f.official_phone, f.official_website, f.specialties, f.source_urls,
         c.* EXCEPT(facility_id), s.has_onc_spec, s.has_neph_spec, s.has_anes_spec
  FROM data_legend.silver.facilities f
  JOIN cap  c USING (facility_id)
  JOIN spec s USING (facility_id)
),
flags AS (
  SELECT *,
    filter(array(
      CASE WHEN (gensurg=1 OR cardsurg=1 OR orthosurg=1) AND anes=0 AND NOT has_anes_spec THEN named_struct('rule','surgery_no_anesthesia','penalty',0.20D) END,
      CASE WHEN icu=1 AND ventilator=0 AND oxygen=0 THEN named_struct('rule','icu_no_life_support','penalty',0.15D) END,
      CASE WHEN oncology=1 AND NOT has_onc_spec THEN named_struct('rule','oncology_no_specialty','penalty',0.15D) END,
      CASE WHEN dialysis=1 AND NOT has_neph_spec THEN named_struct('rule','dialysis_no_nephrology','penalty',0.10D) END,
      CASE WHEN capacity > 50 AND number_doctors IS NULL THEN named_struct('rule','large_capacity_no_doctors','penalty',0.10D) END,
      CASE WHEN ungrounded_yes > 0 THEN named_struct('rule','ungrounded_claims','penalty',least(0.10D, ungrounded_yes*0.02D)) END,
      CASE WHEN length(coalesce(description,'')) < 30 THEN named_struct('rule','thin_description','penalty',0.05D) END,
      CASE WHEN nicu=1 AND peds=0 AND obg=0 THEN named_struct('rule','nicu_no_peds_or_ob','penalty',0.10D) END,
      CASE WHEN trauma=1 AND emergency=0 THEN named_struct('rule','trauma_no_emergency','penalty',0.10D) END
    ), x -> x IS NOT NULL) AS hard_flags,
    (
      (CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN size(coalesce(specialties,array()))>0 THEN 1 ELSE 0 END) +
      (CASE WHEN number_doctors IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN capacity IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN pincode IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN latitude IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN (official_phone IS NOT NULL OR official_website IS NOT NULL) THEN 1 ELSE 0 END) +
      (CASE WHEN size(coalesce(source_urls,array()))>0 THEN 1 ELSE 0 END)
    ) / 8.0D AS coverage_score,
    CASE WHEN description RLIKE '(?i)(LLPIN|\\bCIN\\b|Paid-up capital|Designated Partner|\\bRoC\\b|Active LLP|Registrar of Companies)' THEN 1 ELSE 0 END AS junk_corporate_flag,
    CASE WHEN latitude IS NOT NULL AND NOT (latitude BETWEEN 6 AND 38 AND longitude BETWEEN 68 AND 98) THEN 1 ELSE 0 END AS geo_outlier_flag
  FROM base
)
SELECT facility_id, name, facility_type, hard_flags, coverage_score, junk_corporate_flag, geo_outlier_flag,
  greatest(0.0D, least(1.0D,
      1.0D
    - aggregate(hard_flags, 0.0D, (acc, x) -> acc + x.penalty)
    + 0.15D * coverage_score
    - CASE WHEN junk_corporate_flag=1 THEN 1.0D ELSE 0.0D END
  )) AS trust_score
FROM flags;
