import { describe, it, expect } from 'vitest';
import {
  buildInterpretPrompt,
  parseInterpretJson,
  coerceView,
  coerceGeoLevel,
  coerceCapability,
} from './parse';

describe('parseInterpretJson', () => {
  it('parses clean minified JSON from the model', () => {
    const raw = '{"view":"desert","capability":"cardiology","geo_level":"state","geo_value":"Bihar","note":""}';
    expect(parseInterpretJson(raw)).toEqual({
      view: 'desert',
      capability: 'cardiology',
      geo_level: 'state',
      geo_value: 'Bihar',
      note: '',
    });
  });

  it('parses ```json-fenced output', () => {
    const raw = '```json\n{"view":"trust_desk","capability":"oncology","geo_level":"district","geo_value":"Delhi","note":""}\n```';
    expect(parseInterpretJson(raw)).toEqual({
      view: 'trust_desk',
      capability: 'oncology',
      geo_level: 'district',
      geo_value: 'Delhi',
      note: '',
    });
  });

  it('parses fenced output with no language tag', () => {
    const raw = '```\n{"view":"desert","capability":"icu","geo_level":"null","geo_value":"","note":"x"}\n```';
    expect(parseInterpretJson(raw)?.capability).toBe('icu');
  });

  it('extracts the JSON object even with surrounding prose', () => {
    const raw = 'Here is the JSON you asked for: {"view":"desert","capability":"dialysis","geo_level":"state","geo_value":"Rajasthan","note":""} — done.';
    expect(parseInterpretJson(raw)?.capability).toBe('dialysis');
    expect(parseInterpretJson(raw)?.geo_value).toBe('Rajasthan');
  });

  it('coerces missing string fields to empty strings', () => {
    const raw = '{"view":"desert","capability":"icu"}';
    expect(parseInterpretJson(raw)).toEqual({
      view: 'desert',
      capability: 'icu',
      geo_level: '',
      geo_value: '',
      note: '',
    });
  });

  it('returns null for garbage / non-JSON', () => {
    expect(parseInterpretJson('the model rambled with no json here')).toBeNull();
    expect(parseInterpretJson('')).toBeNull();
    expect(parseInterpretJson('{ not valid json ]')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseInterpretJson(null)).toBeNull();
    expect(parseInterpretJson(undefined)).toBeNull();
    expect(parseInterpretJson(42)).toBeNull();
  });

  it('returns null for a JSON array (not an object)', () => {
    expect(parseInterpretJson('[1,2,3]')).toBeNull();
  });
});

describe('coerceCapability', () => {
  it('returns a capability that is in the allowlist', () => {
    expect(coerceCapability('cardiology')).toBe('cardiology');
    expect(coerceCapability('obstetrics_gynecology')).toBe('obstetrics_gynecology');
  });

  it('returns null for an empty or unknown capability (caller treats as clarify)', () => {
    expect(coerceCapability('')).toBeNull();
    expect(coerceCapability('teleportation')).toBeNull();
  });
});

describe('coerceView', () => {
  it('keeps trust_desk', () => {
    expect(coerceView('trust_desk')).toBe('trust_desk');
  });

  it('defaults anything else to desert', () => {
    expect(coerceView('desert')).toBe('desert');
    expect(coerceView('')).toBe('desert');
    expect(coerceView('nonsense')).toBe('desert');
  });
});

describe('coerceGeoLevel', () => {
  it('accepts the three literal levels', () => {
    expect(coerceGeoLevel('state')).toBe('state');
    expect(coerceGeoLevel('district')).toBe('district');
    expect(coerceGeoLevel('pincode')).toBe('pincode');
  });

  it('maps the model\'s "null" string and anything invalid to null', () => {
    expect(coerceGeoLevel('null')).toBeNull();
    expect(coerceGeoLevel('')).toBeNull();
    expect(coerceGeoLevel('country')).toBeNull();
  });
});

describe('buildInterpretPrompt', () => {
  it('embeds the user query verbatim after the instruction block', () => {
    const prompt = buildInterpretPrompt('cardiology gaps in Bihar');
    expect(prompt).toContain('Query: cardiology gaps in Bihar');
    expect(prompt).toContain('Output ONLY minified JSON');
    expect(prompt).toContain('obstetrics_gynecology');
  });
});
