-- 00_silver_facilities.sql
-- Canonical build of data_legend.silver.facilities from the shared DAIS-2026 table.
-- Filters to the 10,000 clean facility rows, normalizes literal 'null'/'[]' to NULL,
-- parses JSON-array text fields, casts numerics, and DEDUPES on facility_id
-- (source unique_id has 11 collisions) keeping the most-complete row.
-- Also quarantines the ~88 column-shifted/malformed rows for the Data-Readiness surface.

CREATE OR REPLACE TABLE data_legend.silver.facilities AS
WITH raw AS (
  SELECT
    unique_id AS facility_id,
    cluster_id, name,
    facilityTypeId AS facility_type,
    operatorTypeId AS operator_type,
    from_json(affiliationTypeIds, 'array<string>') AS affiliation_types,
    CASE WHEN trim(description) IN ('','null','[]','None') THEN NULL ELSE description END AS description,
    from_json(specialties, 'array<string>')     AS specialties,
    from_json(capability,   'array<string>')     AS capability_facts,
    from_json(procedure,    'array<string>')     AS procedure_facts,
    from_json(equipment,    'array<string>')     AS equipment_facts,
    try_cast(CASE WHEN trim(numberDoctors)   IN ('','null') THEN NULL ELSE numberDoctors   END AS INT) AS number_doctors,
    try_cast(CASE WHEN trim(capacity)        IN ('','null') THEN NULL ELSE capacity        END AS INT) AS capacity,
    try_cast(CASE WHEN trim(yearEstablished) IN ('','null') THEN NULL ELSE yearEstablished END AS INT) AS year_established,
    try_cast(CASE WHEN trim(area)            IN ('','null') THEN NULL ELSE area            END AS INT) AS area_sqm,
    from_json(source_urls, 'array<string>') AS source_urls,
    CASE WHEN trim(officialWebsite) IN ('','null') THEN NULL ELSE officialWebsite END AS official_website,
    CASE WHEN trim(officialPhone)   IN ('','null') THEN NULL ELSE officialPhone   END AS official_phone,
    CASE WHEN trim(address_city)          IN ('','null') THEN NULL ELSE address_city          END AS city,
    CASE WHEN trim(address_stateOrRegion) IN ('','null') THEN NULL ELSE address_stateOrRegion END AS state_raw,
    CASE WHEN trim(address_zipOrPostcode) IN ('','null') THEN NULL ELSE address_zipOrPostcode END AS pincode,
    latitude, longitude,
    CASE WHEN trim(recency_of_page_update) IN ('','null') THEN NULL ELSE recency_of_page_update END AS recency_of_page_update
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE organization_type = 'facility'
)
SELECT * EXCEPT(_rn) FROM (
  SELECT *, row_number() OVER (
    PARTITION BY facility_id
    ORDER BY length(coalesce(description,'')) DESC,
             size(coalesce(capability_facts, array())) DESC,
             size(coalesce(specialties, array())) DESC
  ) AS _rn
  FROM raw
) WHERE _rn = 1;

-- Quarantine: malformed/column-shifted source rows (surfaced, not dropped silently).
CREATE OR REPLACE TABLE data_legend.silver.facilities_quarantine AS
SELECT unique_id AS facility_id, organization_type, facilityTypeId, name, description
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
WHERE organization_type IS DISTINCT FROM 'facility';
