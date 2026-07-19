import { describe, it, expect } from 'vitest';
import { haversineKm } from './haversine';

describe('haversineKm', () => {
  it('computes Mumbai-Delhi ~1150km', () => {
    const km = haversineKm(19.0760, 72.8777, 28.6139, 77.2090);
    expect(km).toBeGreaterThan(1100);
    expect(km).toBeLessThan(1200);
  });
});
