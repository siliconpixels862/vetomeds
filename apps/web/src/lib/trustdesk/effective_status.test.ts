import { describe, it, expect } from 'vitest';
import { effectiveStatus } from './effective_status';

describe('effectiveStatus', () => {
  it('returns the machine status, unverified, when there is no override', () => {
    expect(effectiveStatus({ status: 'yes' }, undefined)).toEqual({ status: 'yes', verified: false });
  });

  it('layers a human override on top of the machine status without mutating machine reasoning', () => {
    expect(
      effectiveStatus({ status: 'yes' }, { human_verdict: 'no', app_user: 'u@x', note: 'called: no ICU' })
    ).toEqual({ status: 'no', verified: true, by: 'u@x', note: 'called: no ICU', at: undefined });
  });

  it('lets a human override flip an unclear machine status to yes', () => {
    expect(effectiveStatus({ status: 'unclear' }, { human_verdict: 'yes', app_user: 'u', note: null }).status).toBe(
      'yes'
    );
  });

  it('treats a null override the same as no override', () => {
    expect(effectiveStatus({ status: 'no' }, null)).toEqual({ status: 'no', verified: false });
  });

  it('carries through the updated_at timestamp as `at` when present', () => {
    expect(
      effectiveStatus(
        { status: 'unclear' },
        { human_verdict: 'unclear', app_user: 'u@x', note: null, updated_at: '2026-07-19T00:00:00Z' }
      )
    ).toEqual({
      status: 'unclear',
      verified: true,
      by: 'u@x',
      note: null,
      at: '2026-07-19T00:00:00Z',
    });
  });
});
