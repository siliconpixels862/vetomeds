import { describe, it, expect } from 'vitest';
import { toBool } from './parse';

describe('toBool', () => {
  it("returns false for the string 'false'", () => {
    expect(toBool('false')).toBe(false);
  });

  it("returns true for the string 'true'", () => {
    expect(toBool('true')).toBe(true);
  });

  it('returns true for the boolean true', () => {
    expect(toBool(true)).toBe(true);
  });

  it('returns false for the boolean false', () => {
    expect(toBool(false)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(toBool(undefined)).toBe(false);
  });

  it("returns false for the string '0'", () => {
    expect(toBool('0')).toBe(false);
  });

  it("returns true for the string '1'", () => {
    expect(toBool('1')).toBe(true);
  });

  it('returns true for the number 1', () => {
    expect(toBool(1)).toBe(true);
  });

  it('returns false for the number 0', () => {
    expect(toBool(0)).toBe(false);
  });

  it("is case-insensitive for 'TRUE' and 'False'", () => {
    expect(toBool('TRUE')).toBe(true);
    expect(toBool('False')).toBe(false);
  });

  it("returns true for the string 't'", () => {
    expect(toBool('t')).toBe(true);
  });

  it('returns false for null', () => {
    expect(toBool(null)).toBe(false);
  });
});
