/**
 * Layers a human-verified override on top of a machine capability assessment.
 *
 * This is the core rule for the Trust Desk override feature: the machine assessment
 * is NEVER mutated. Callers keep the machine's status/evidence/reasoning exactly as
 * computed by the pipeline; `effectiveStatus` only computes what should be *displayed*
 * as the current answer, plus whether a human has verified it and who/why.
 */

export interface MachineAssessment {
  status: 'yes' | 'no' | 'unclear';
}

export interface OverrideRow {
  human_verdict: 'yes' | 'no' | 'unclear';
  app_user: string;
  note: string | null;
  updated_at?: string;
}

export interface EffectiveStatus {
  status: 'yes' | 'no' | 'unclear';
  verified: boolean;
  by?: string;
  note?: string | null;
  at?: string;
}

export function effectiveStatus(machine: MachineAssessment, override?: OverrideRow | null): EffectiveStatus {
  if (!override) {
    return { status: machine.status, verified: false };
  }

  return {
    status: override.human_verdict,
    verified: true,
    by: override.app_user,
    note: override.note,
    at: override.updated_at,
  };
}
