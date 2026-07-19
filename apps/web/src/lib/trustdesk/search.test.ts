import { describe, it, expect } from 'vitest';
import { buildTrustDeskQuery } from './search';

describe('buildTrustDeskQuery', () => {
  it('throws on an unknown capability', () => {
    expect(() => buildTrustDeskQuery('not_a_real_capability')).toThrow();
  });

  it('throws on a capability that looks like a SQL injection attempt', () => {
    expect(() => buildTrustDeskQuery("icu; DROP TABLE facilities; --")).toThrow();
  });

  it('parameterizes the capability and filters status + junk_corporate_flag', () => {
    const { sql, params } = buildTrustDeskQuery('icu');
    expect(sql).toContain('fc.capability = :capability');
    expect(sql).toContain("fc.status IN ('yes','unclear')");
    expect(sql).toContain('t.junk_corporate_flag = 0');
    expect(params).toContainEqual({ name: 'capability', value: 'icu' });
  });

  it('includes a state filter only when a state is provided', () => {
    const withState = buildTrustDeskQuery('icu', 'Maharashtra');
    expect(withState.sql).toContain('f.state_raw ILIKE');
    expect(withState.params).toContainEqual({ name: 'state', value: '%Maharashtra%' });

    const withoutState = buildTrustDeskQuery('icu');
    expect(withoutState.sql).not.toContain('state_raw ILIKE');
    expect(withoutState.params.find(p => p.name === 'state')).toBeUndefined();
  });

  it('includes a city filter only when a city is provided', () => {
    const withCity = buildTrustDeskQuery('icu', undefined, 'Pune');
    expect(withCity.sql).toContain('f.city ILIKE');
    expect(withCity.params).toContainEqual({ name: 'city', value: '%Pune%' });

    const withoutCity = buildTrustDeskQuery('icu');
    expect(withoutCity.sql).not.toContain('f.city ILIKE');
    expect(withoutCity.params.find(p => p.name === 'city')).toBeUndefined();
  });

  it('includes an exact pincode filter only when a pincode is provided', () => {
    const withPincode = buildTrustDeskQuery('icu', undefined, undefined, '411001');
    expect(withPincode.sql).toContain('f.pincode = :pincode');
    expect(withPincode.params).toContainEqual({ name: 'pincode', value: '411001' });

    const withoutPincode = buildTrustDeskQuery('icu');
    expect(withoutPincode.sql).not.toContain('f.pincode = :pincode');
    expect(withoutPincode.params.find(p => p.name === 'pincode')).toBeUndefined();
  });

  it('orders results with status=yes before unclear, then grounded, then trust_score', () => {
    const { sql } = buildTrustDeskQuery('icu');
    const orderByIdx = sql.indexOf('ORDER BY');
    expect(orderByIdx).toBeGreaterThan(-1);
    const orderByClause = sql.slice(orderByIdx);
    const yesIdx = orderByClause.indexOf("fc.status = 'yes'");
    const groundedIdx = orderByClause.indexOf('fc.grounded');
    const trustScoreIdx = orderByClause.indexOf('t.trust_score');
    expect(yesIdx).toBeGreaterThan(-1);
    expect(groundedIdx).toBeGreaterThan(-1);
    expect(trustScoreIdx).toBeGreaterThan(-1);
    expect(yesIdx).toBeLessThan(groundedIdx);
    expect(groundedIdx).toBeLessThan(trustScoreIdx);
  });

  it('caps results at 50', () => {
    const { sql } = buildTrustDeskQuery('icu');
    expect(sql).toContain('LIMIT 50');
  });
});
