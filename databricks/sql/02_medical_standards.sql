-- 02_medical_standards.sql
-- Reference rules the Trust Scorer + validator use to corroborate capability claims.
-- 'requires' names a capability or a controlled specialty token that SHOULD co-occur
-- with the claimed 'capability'; its absence is a suspicious-claim signal.

CREATE OR REPLACE TABLE data_legend.silver.medical_standards AS
SELECT * FROM VALUES
  ('std_gensurg_anes',   'general_surgery',      'anesthesiology_staff', 'capability', 'Surgery requires anesthesia support'),
  ('std_cardsurg_anes',  'cardiac_surgery',      'anesthesiology_staff', 'capability', 'Cardiac surgery requires anesthesia'),
  ('std_orthosurg_anes', 'orthopedic_surgery',   'anesthesiology_staff', 'capability', 'Orthopedic surgery requires anesthesia'),
  ('std_icu_vent',       'icu',                  'ventilator',           'capability', 'Functional ICU needs ventilator support'),
  ('std_icu_o2',         'icu',                  'oxygen_supply',        'capability', 'Functional ICU needs oxygen supply'),
  ('std_onc_spec',       'oncology',             'medicalOncology',      'specialty',  'Oncology claim should be backed by an oncology specialty'),
  ('std_dial_neph',      'dialysis',             'nephrology',           'specialty',  'Dialysis is delivered under nephrology'),
  ('std_nicu_peds',      'neonatal_nicu',        'pediatrics',           'capability', 'NICU requires pediatric care'),
  ('std_nicu_obg',       'neonatal_nicu',        'obstetrics_gynecology','capability', 'NICU pairs with obstetric care'),
  ('std_trauma_er',      'trauma_center',        'emergency_24x7',       'capability', 'Trauma center requires 24x7 emergency'),
  ('std_cardsurg_cardio','cardiac_surgery',      'cardiology',           'capability', 'Cardiac surgery pairs with cardiology'),
  ('std_ctscan_rad',     'ct_scan',              'radiology',            'specialty',  'CT imaging is delivered under radiology'),
  ('std_vent_o2',        'ventilator',           'oxygen_supply',        'capability', 'Mechanical ventilation requires oxygen supply')
AS t(rule_id, capability, requires, requires_type, rationale);
