import type { EffectiveStatus } from './effective_status';

export interface TrustDeskResult {
  facility_id: string;
  name: string;
  facility_type: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  trust_score: number;
  capability_status: 'yes' | 'unclear';
  evidence_sentence: string | null;
  source_field: string | null;
  grounded: boolean;
  hard_flag_count: number;
  /** Human-verified status layered on top of `capability_status`, when a planner has overridden it. */
  effective: EffectiveStatus;
}

/** A row from the Lakebase `facility_overrides` table — the human-verified layer, team-visible. */
export interface FacilityOverride {
  id: number;
  app_user: string;
  facility_id: string;
  capability: string;
  machine_status: string | null;
  machine_score: number | null;
  human_verdict: 'yes' | 'no' | 'unclear';
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FacilityDetail {
  facility_id: string;
  name: string;
  facility_type: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  description: string | null;
  specialties: string[];
  source_urls: string[];
  number_doctors: number | null;
  capacity: number | null;
  year_established: number | null;
  official_phone: string | null;
  official_website: string | null;
  trust_score: number;
  coverage_score: number;
  hard_flags: { rule: string; penalty: number }[];
  capabilities: {
    capability: string;
    status: 'yes' | 'no' | 'unclear';
    evidence_sentence: string | null;
    source_field: string | null;
    grounded: boolean;
  }[];
}

/** The 6 first-class capabilities shown directly in the picker. */
export const PRIMARY_CAPABILITIES: { label: string; value: string }[] = [
  { label: 'ICU', value: 'icu' },
  { label: 'Maternity', value: 'obstetrics_gynecology' },
  { label: 'Emergency 24x7', value: 'emergency_24x7' },
  { label: 'Oncology', value: 'oncology' },
  { label: 'Trauma', value: 'trauma_center' },
  { label: 'NICU', value: 'neonatal_nicu' },
];

/** The remaining 15 capabilities, shown under an "All capabilities" optgroup. */
export const OTHER_CAPABILITIES: { label: string; value: string }[] = [
  { label: 'Ambulance', value: 'ambulance' },
  { label: 'General surgery', value: 'general_surgery' },
  { label: 'Cardiac surgery', value: 'cardiac_surgery' },
  { label: 'Orthopedic surgery', value: 'orthopedic_surgery' },
  { label: 'Anesthesiology staff', value: 'anesthesiology_staff' },
  { label: 'Dialysis', value: 'dialysis' },
  { label: 'Cardiology', value: 'cardiology' },
  { label: 'Neurology', value: 'neurology' },
  { label: 'Pediatrics', value: 'pediatrics' },
  { label: 'CT scan', value: 'ct_scan' },
  { label: 'MRI', value: 'mri' },
  { label: 'Ultrasound', value: 'ultrasound' },
  { label: 'Pathology lab', value: 'pathology_lab' },
  { label: 'Ventilator', value: 'ventilator' },
  { label: 'Oxygen supply', value: 'oxygen_supply' },
];

/** All 21 known capability values — used to validate query params against SQL injection via identifiers. */
export const ALL_CAPABILITIES: string[] = [
  ...PRIMARY_CAPABILITIES.map(c => c.value),
  ...OTHER_CAPABILITIES.map(c => c.value),
];
