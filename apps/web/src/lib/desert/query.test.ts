import { describe, it, expect } from 'vitest';
import { buildDesertQuery, buildDesertSummaryQuery, summarize, summaryFromAggregate } from './query';

describe('buildDesertQuery', () => {
  it('throws on an unknown capability', () => {
    expect(() => buildDesertQuery('not_a_real_capability')).toThrow();
  });

  it('throws on a capability that looks like a SQL injection attempt', () => {
    expect(() => buildDesertQuery("icu'; DROP TABLE pincode_capability_gaps; --")).toThrow();
  });

  it('throws on an unknown geoLevel', () => {
    expect(() => buildDesertQuery('icu', 'country' as never, 'India')).toThrow();
  });

  it('does not throw when geoLevel is omitted', () => {
    expect(() => buildDesertQuery('icu')).not.toThrow();
  });

  it('parameterizes the capability and joins the centroid subquery', () => {
    const { sql, params } = buildDesertQuery('icu');
    expect(sql).toContain('g.capability = :capability');
    expect(sql).toContain('LEFT JOIN');
    expect(sql).toContain('data_legend.gold.pincode_capability_gaps');
    expect(sql).toContain('data_legend.silver.facilities');
    expect(sql).toContain("RLIKE '^[0-9]{6}\\$'".replace('\\$', '$'));
    expect(params).toContainEqual({ name: 'capability', value: 'icu' });
  });

  it('filters by state with a bound param, never interpolating the raw value', () => {
    const evilValue = "Bihar' OR '1'='1";
    const { sql, params } = buildDesertQuery('icu', 'state', evilValue);
    expect(sql).toContain("g.state ILIKE '%'||:geo||'%'");
    expect(sql).not.toContain(evilValue);
    expect(params).toContainEqual({ name: 'geo', value: evilValue });
  });

  it('filters by district with a bound param', () => {
    const { sql, params } = buildDesertQuery('icu', 'district', 'Patna');
    expect(sql).toContain("g.district ILIKE '%'||:geo||'%'");
    expect(params).toContainEqual({ name: 'geo', value: 'Patna' });
  });

  it('filters by pincode with an exact-match bound param', () => {
    const { sql, params } = buildDesertQuery('icu', 'pincode', '800001');
    expect(sql).toContain('g.pincode = :geo');
    expect(params).toContainEqual({ name: 'geo', value: '800001' });
  });

  it('omits any geo filter and geo param when geoLevel is not provided', () => {
    const { sql, params } = buildDesertQuery('icu');
    expect(sql).not.toContain(':geo');
    expect(params.find(p => p.name === 'geo')).toBeUndefined();
  });

  it('orders medical_desert first, then data_desert, then covered, and by facilities_in_pin desc', () => {
    const { sql } = buildDesertQuery('icu');
    const orderByIdx = sql.indexOf('ORDER BY');
    expect(orderByIdx).toBeGreaterThan(-1);
    const clause = sql.slice(orderByIdx);
    const medicalIdx = clause.indexOf("'medical_desert'");
    const dataIdx = clause.indexOf("'data_desert'");
    const coveredIdx = clause.indexOf("'covered'");
    expect(medicalIdx).toBeGreaterThan(-1);
    expect(dataIdx).toBeGreaterThan(-1);
    expect(coveredIdx).toBeGreaterThan(-1);
    expect(medicalIdx).toBeLessThan(dataIdx);
    expect(dataIdx).toBeLessThan(coveredIdx);
    expect(clause).toContain('facilities_in_pin DESC');
  });

  it('caps results at 500', () => {
    const { sql } = buildDesertQuery('icu');
    expect(sql).toContain('LIMIT 500');
  });
});

describe('buildDesertSummaryQuery', () => {
  it('throws on an unknown capability', () => {
    expect(() => buildDesertSummaryQuery('not_a_real_capability')).toThrow();
  });

  it('throws on a capability that looks like a SQL injection attempt', () => {
    expect(() => buildDesertSummaryQuery("icu'; DROP TABLE pincode_capability_gaps; --")).toThrow();
  });

  it('throws on an unknown geoLevel', () => {
    expect(() => buildDesertSummaryQuery('icu', 'country' as never, 'India')).toThrow();
  });

  it('does not throw when geoLevel is omitted', () => {
    expect(() => buildDesertSummaryQuery('icu')).not.toThrow();
  });

  it('groups by desert_state and has no row limit', () => {
    const { sql, params } = buildDesertSummaryQuery('icu');
    expect(sql).toContain('GROUP BY desert_state');
    expect(sql).not.toContain('LIMIT');
    expect(sql).not.toContain('LEFT JOIN');
    expect(sql).toContain('g.capability = :capability');
    expect(sql).toContain('data_legend.gold.pincode_capability_gaps');
    expect(params).toContainEqual({ name: 'capability', value: 'icu' });
  });

  it('filters by state with a bound param, never interpolating the raw value', () => {
    const evilValue = "Bihar' OR '1'='1";
    const { sql, params } = buildDesertSummaryQuery('icu', 'state', evilValue);
    expect(sql).toContain("g.state ILIKE '%'||:geo||'%'");
    expect(sql).not.toContain(evilValue);
    expect(params).toContainEqual({ name: 'geo', value: evilValue });
  });

  it('filters by district with a bound param', () => {
    const { sql, params } = buildDesertSummaryQuery('icu', 'district', 'Patna');
    expect(sql).toContain("g.district ILIKE '%'||:geo||'%'");
    expect(params).toContainEqual({ name: 'geo', value: 'Patna' });
  });

  it('filters by pincode with an exact-match bound param', () => {
    const { sql, params } = buildDesertSummaryQuery('icu', 'pincode', '800001');
    expect(sql).toContain('g.pincode = :geo');
    expect(params).toContainEqual({ name: 'geo', value: '800001' });
  });

  it('omits any geo filter and geo param when geoLevel is not provided', () => {
    const { sql, params } = buildDesertSummaryQuery('icu');
    expect(sql).not.toContain(':geo');
    expect(params.find(p => p.name === 'geo')).toBeUndefined();
  });
});

describe('summaryFromAggregate', () => {
  it('builds the summary from aggregate rows, casting n to a number', () => {
    const rows = [
      { desert_state: 'covered', n: '842' },
      { desert_state: 'medical_desert', n: 12 },
      { desert_state: 'data_desert', n: 5 },
    ];
    expect(summaryFromAggregate(rows)).toEqual({ covered: 842, medical_desert: 12, data_desert: 5 });
  });

  it('defaults missing states to 0 rather than dropping them', () => {
    const rows = [{ desert_state: 'medical_desert', n: 3 }];
    expect(summaryFromAggregate(rows)).toEqual({ covered: 0, medical_desert: 3, data_desert: 0 });
  });

  it('returns all-zero counts for an empty aggregate', () => {
    expect(summaryFromAggregate([])).toEqual({ covered: 0, medical_desert: 0, data_desert: 0 });
  });

  it('ignores unrecognized desert_state values rather than throwing', () => {
    const rows = [{ desert_state: 'covered', n: 1 }, { desert_state: 'something_else', n: 99 }];
    expect(summaryFromAggregate(rows)).toEqual({ covered: 1, medical_desert: 0, data_desert: 0 });
  });
});

describe('summarize', () => {
  it('counts cells into covered/medical_desert/data_desert buckets', () => {
    const cells = [
      { desert_state: 'covered' },
      { desert_state: 'covered' },
      { desert_state: 'medical_desert' },
      { desert_state: 'data_desert' },
      { desert_state: 'data_desert' },
      { desert_state: 'data_desert' },
    ];
    expect(summarize(cells)).toEqual({ covered: 2, medical_desert: 1, data_desert: 3 });
  });

  it('returns all-zero counts for an empty list', () => {
    expect(summarize([])).toEqual({ covered: 0, medical_desert: 0, data_desert: 0 });
  });

  it('ignores unrecognized desert_state values rather than throwing', () => {
    const cells = [{ desert_state: 'covered' }, { desert_state: 'something_else' }];
    expect(summarize(cells)).toEqual({ covered: 1, medical_desert: 0, data_desert: 0 });
  });
});
