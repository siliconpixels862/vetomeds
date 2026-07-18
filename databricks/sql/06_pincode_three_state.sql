-- 06_pincode_three_state.sql
-- gold.pincode_capability_gaps: per (pincode, capability), trust-weighted coverage
-- classified into the THREE honest states:
--   covered        = >=1 facility with status 'yes'
--   data_desert    = no yes, but signal too sparse to judge ("we don't know")
--   medical_desert = no yes, facilities well-documented but genuinely lack it
-- Overrides are merged live at query time (app); this is the machine-derived base.

CREATE OR REPLACE TABLE data_legend.gold.pincode_capability_gaps AS
WITH fc AS (
  SELECT f.pincode, fc.capability, fc.facility_id, fc.status,
         t.coverage_score, t.trust_score, COALESCE(t.junk_corporate_flag,0) AS junk
  FROM data_legend.silver.facility_capabilities fc
  JOIN data_legend.silver.facilities f USING (facility_id)
  LEFT JOIN data_legend.gold.facility_trust t USING (facility_id)
  WHERE f.pincode IS NOT NULL AND f.pincode RLIKE '^[0-9]{6}$'
),
kept AS (SELECT * FROM fc WHERE junk = 0),
agg AS (
  SELECT pincode, capability,
    COUNT(DISTINCT facility_id) AS facilities_in_pin,
    SUM(CASE WHEN status='yes'     THEN 1 ELSE 0 END) AS yes_count,
    SUM(CASE WHEN status='unclear' THEN 1 ELSE 0 END) AS unclear_count,
    SUM(CASE WHEN status='no'      THEN 1 ELSE 0 END) AS no_count,
    SUM(CASE WHEN status='yes' THEN COALESCE(trust_score,0.5) ELSE 0 END) AS trust_weighted_yes,
    AVG(COALESCE(coverage_score,0.0)) AS avg_coverage
  FROM kept GROUP BY pincode, capability
),
pin AS (
  SELECT lpad(CAST(pincode AS STRING),6,'0') AS pincode,
         MAX(district) AS district, MAX(statename) AS state
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE pincode IS NOT NULL
  GROUP BY lpad(CAST(pincode AS STRING),6,'0')
)
SELECT a.pincode, a.capability, a.facilities_in_pin, a.yes_count, a.unclear_count, a.no_count,
  a.trust_weighted_yes, ROUND(a.avg_coverage,3) AS avg_coverage,
  p.district, p.state,
  CASE
    WHEN a.yes_count >= 1 THEN 'covered'
    WHEN a.unclear_count >= 1 OR a.avg_coverage < 0.6 THEN 'data_desert'
    ELSE 'medical_desert'
  END AS desert_state
FROM agg a
LEFT JOIN pin p ON a.pincode = p.pincode;
