'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { TrustBadge } from '@/components/TrustBadge';
import Select, { type SelectOption } from '@/components/Select';
import { PRIMARY_CAPABILITIES, OTHER_CAPABILITIES } from '@/lib/trustdesk/types';
import type { DesertCell, DesertSummary, Scenario } from '@/lib/desert/types';

const IndiaMap = dynamic(() => import('@/components/IndiaMap'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 shimmer" />,
});

type Status = 'idle' | 'loading' | 'error' | 'done';
type GeoLevelOption = '' | 'state' | 'district' | 'pincode';

interface DrillFacility {
  facility_id: string;
  name: string;
  facility_type: string | null;
  status: 'yes' | 'no' | 'unclear';
  evidence_sentence: string | null;
  grounded: boolean;
  trust_score: number | null;
}

const CAP_LABELS: Record<string, string> = Object.fromEntries(
  [...PRIMARY_CAPABILITIES, ...OTHER_CAPABILITIES].map(c => [c.value, c.label])
);

const GEO_LABELS: Record<GeoLevelOption, string> = {
  '': 'All India',
  state: 'State',
  district: 'District',
  pincode: 'PIN code',
};

const CAP_OPTIONS: SelectOption[] = [
  ...PRIMARY_CAPABILITIES.map(c => ({ value: c.value, label: c.label, group: 'Common' })),
  ...OTHER_CAPABILITIES.map(c => ({ value: c.value, label: c.label, group: 'All capabilities' })),
];

const GEO_OPTIONS: SelectOption[] = [
  { value: '', label: 'All India' },
  { value: 'state', label: 'State' },
  { value: 'district', label: 'District' },
  { value: 'pincode', label: 'PIN code' },
];

const DESERT_STYLES: Record<DesertCell['desert_state'], { chip: string; dot: string; label: string; tile: string; num: string }> = {
  covered: {
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Covered',
    tile: 'bg-emerald-50/70 border-emerald-100',
    num: 'text-emerald-700',
  },
  medical_desert: {
    chip: 'bg-rose-50 text-rose-800 border-rose-200',
    dot: 'bg-rose-500',
    label: 'Medical desert',
    tile: 'bg-rose-50/70 border-rose-100',
    num: 'text-rose-700',
  },
  data_desert: {
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
    label: 'Data desert',
    tile: 'bg-slate-50 border-slate-200',
    num: 'text-slate-600',
  },
};

const STATUS_STYLES: Record<string, string> = {
  yes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  unclear: 'bg-amber-50 text-amber-800 border-amber-200',
  no: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function DesertPlannerPage() {
  const [capability, setCapability] = useState('icu');
  const [geoLevel, setGeoLevel] = useState<GeoLevelOption>('');
  const [geoValue, setGeoValue] = useState('');

  const [cells, setCells] = useState<DesertCell[]>([]);
  const [summary, setSummary] = useState<DesertSummary>({ covered: 0, medical_desert: 0, data_desert: 0 });
  const [totalCells, setTotalCells] = useState(0);
  const [cellsTruncated, setCellsTruncated] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzedCapability, setAnalyzedCapability] = useState('icu');

  const [selectedCell, setSelectedCell] = useState<DesertCell | null>(null);
  const [drillFacilities, setDrillFacilities] = useState<DrillFacility[]>([]);
  const [drillStatus, setDrillStatus] = useState<Status>('idle');
  const [drillError, setDrillError] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [scenariosVersion, setScenariosVersion] = useState(0);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function doAnalyze(cap: string, level: GeoLevelOption, value: string) {
    setStatus('loading');
    setError(null);
    setSelectedCell(null);
    try {
      const qs = new URLSearchParams({ capability: cap });
      if (level) qs.set('geo_level', level);
      if (level && value.trim()) qs.set('geo_value', value.trim());

      const resp = await fetch(`/api/desert?${qs.toString()}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      const nextCells = (json.cells ?? []) as DesertCell[];
      setCells(nextCells);
      setSummary((json.summary ?? { covered: 0, medical_desert: 0, data_desert: 0 }) as DesertSummary);
      setTotalCells(typeof json.total_cells === 'number' ? json.total_cells : nextCells.length);
      setCellsTruncated(Boolean(json.cells_truncated));
      setAnalyzedCapability(cap);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function runAnalyze(e?: FormEvent) {
    e?.preventDefault();
    void doAnalyze(capability, geoLevel, geoValue);
  }

  const loadScenarios = useCallback(async () => {
    setScenariosError(null);
    try {
      const resp = await fetch('/api/scenarios');
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setScenarios((json.scenarios ?? []) as Scenario[]);
    } catch (err) {
      setScenariosError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenariosLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadScenarios();
  }, [loadScenarios, scenariosVersion]);

  const handleCellClick = useCallback(async (cell: DesertCell) => {
    setSelectedCell(cell);
    setDrillStatus('loading');
    setDrillError(null);
    try {
      const qs = new URLSearchParams({ capability: analyzedCapability, pincode: cell.pincode });
      const resp = await fetch(`/api/desert/facilities?${qs.toString()}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setDrillFacilities((json.facilities ?? []) as DrillFacility[]);
      setDrillStatus('done');
    } catch (err) {
      setDrillError(err instanceof Error ? err.message : String(err));
      setDrillStatus('error');
    }
  }, [analyzedCapability]);

  async function handleSaveScenario(e?: FormEvent) {
    e?.preventDefault();
    if (!saveName.trim()) {
      setSaveError('Give the scenario a name first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          capability,
          geo_level: geoLevel || null,
          geo_value: geoLevel && geoValue.trim() ? geoValue.trim() : null,
          filters_json: { capability, geo_level: geoLevel || null, geo_value: geoValue.trim() || null },
          snapshot_json: summary,
          note: saveNote.trim() || null,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setSaveOpen(false);
      setSaveName('');
      setSaveNote('');
      setScenariosVersion(v => v + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadScenario(scenario: Scenario) {
    const cap = scenario.capability ?? capability;
    const level = ((scenario.geo_level as GeoLevelOption) ?? '') || '';
    const value = scenario.geo_value ?? '';
    setCapability(cap);
    setGeoLevel(level);
    setGeoValue(value);
    await doAnalyze(cap, level, value);
  }

  async function handleDeleteScenario(id: number) {
    try {
      const resp = await fetch('/api/scenarios', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setScenarios(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setScenariosError(err instanceof Error ? err.message : String(err));
    }
  }

  const mapCells = cells.filter(c => c.lat != null && c.lng != null);
  const noCoordCount = cells.length - mapCells.length;
  const totalPins = summary.covered + summary.medical_desert + summary.data_desert;

  return (
    <main className="hero-bg min-h-[calc(100vh-64px)]">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
        <div className="animate-fade-up max-w-2xl">
          <span className="chip chip-sky mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            <span>Medical Desert Planner</span>
          </span>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-[1.1] mb-3">
            Where are the real gaps — and how confident are we?
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-8">
            Pick a capability and a region. Every pincode is one of three honest states — never a
            guess dressed up as coverage.
          </p>
        </div>

        {/* Controls (full width, above both panes) */}
        <form onSubmit={runAnalyze} className="card p-4 sm:p-5 mb-6 animate-fade-up" style={{ animationDelay: '40ms' }}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              <span>Capability</span>
              <Select value={capability} onChange={setCapability} options={CAP_OPTIONS} label="Capability" />
            </div>

            <div className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              <span>Geography</span>
              <Select
                value={geoLevel}
                onChange={v => setGeoLevel(v as GeoLevelOption)}
                options={GEO_OPTIONS}
                label="Geography"
              />
            </div>

            {geoLevel && (
              <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 sm:col-span-2">
                {GEO_LABELS[geoLevel]}
                <input
                  type="text"
                  value={geoValue}
                  onChange={e =>
                    setGeoValue(
                      geoLevel === 'pincode' ? e.target.value.replace(/[^0-9]/g, '').slice(0, 6) : e.target.value
                    )
                  }
                  placeholder={geoLevel === 'pincode' ? '6 digits' : geoLevel === 'state' ? 'e.g. Bihar' : 'e.g. Patna'}
                  inputMode={geoLevel === 'pincode' ? 'numeric' : 'text'}
                  maxLength={geoLevel === 'pincode' ? 6 : undefined}
                  className="field"
                />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button type="submit" className="btn-primary" disabled={status === 'loading'}>
              {status === 'loading' ? 'Analyzing…' : 'Analyze'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setSaveName(prev => prev || `${CAP_LABELS[capability] ?? capability} — ${geoValue.trim() || 'All India'}`);
                setSaveOpen(o => !o);
              }}
              disabled={status !== 'done'}
              className="btn-secondary"
            >
              {saveOpen ? 'Cancel save' : 'Save scenario'}
            </button>
          </div>

          {saveOpen && (
            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-3 sm:p-4 space-y-2 animate-fade-up">
              <input
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveScenario(); } }}
                placeholder="Scenario name"
                maxLength={120}
                className="field"
              />
              <textarea
                value={saveNote}
                onChange={e => setSaveNote(e.target.value)}
                placeholder="Note (optional) — why does this scenario matter?"
                rows={2}
                className="field"
              />
              {saveError && <p className="text-xs text-rose-700">{saveError}</p>}
              <button type="button" onClick={() => handleSaveScenario()} className="btn-primary px-3 py-1.5 text-xs" disabled={saving}>
                {saving ? 'Saving…' : 'Save scenario'}
              </button>
            </div>
          )}
        </form>

        {status === 'error' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm mb-6 animate-fade-up">
            Something went wrong: {error}
          </div>
        )}

        {status === 'loading' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
            <div className="lg:col-span-7 card h-[560px] shimmer" />
            <div className="lg:col-span-5 space-y-3">
              <div className="card h-28 shimmer" />
              <div className="card h-96 shimmer" />
            </div>
          </div>
        )}

        {status === 'done' && cells.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600 text-center mb-6 animate-fade-up">
            No pincodes matched this capability + region combination.
          </div>
        )}

        {status === 'done' && cells.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6 items-start">
            {/* LEFT — map */}
            <div className="lg:col-span-7 lg:sticky lg:top-24">
              <div className="panel overflow-hidden relative h-[460px] min-h-[420px] sm:h-[560px] lg:h-[calc(100vh-8rem)] lg:max-h-[720px] animate-fade-up">
                <IndiaMap cells={mapCells} selectedPincode={selectedCell?.pincode ?? null} onSelect={handleCellClick} />

                {/* Title chip */}
                <div className="absolute top-3 left-3 z-10 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm border border-slate-200/70">
                  Coverage map · {mapCells.length} pincode{mapCells.length === 1 ? '' : 's'}
                </div>

                {/* Legend */}
                <div className="absolute bottom-3 left-3 z-10 rounded-xl bg-white/92 backdrop-blur px-3 py-2.5 text-xs shadow-md border border-slate-200/70 max-w-[15rem]">
                  <div className="flex flex-col gap-1.5">
                    <LegendDot className="bg-emerald-500" label={`Covered · ${summary.covered}`} />
                    <LegendDot className="bg-rose-500" label={`Medical desert · ${summary.medical_desert}`} />
                    <LegendDot className="bg-slate-400" label={`Data desert · ${summary.data_desert}`} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2 leading-snug border-t border-slate-100 pt-2">
                    Data desert = facilities exist but records are too sparse to judge. Not the same as no care.
                  </p>
                </div>

                {noCoordCount > 0 && (
                  <div className="absolute bottom-3 right-3 z-10 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[11px] text-slate-500 shadow-sm border border-slate-200/70">
                    {noCoordCount} without coordinates (see table)
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — details */}
            <div className="lg:col-span-5 space-y-5">
              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3 animate-fade-up" style={{ animationDelay: '60ms' }}>
                <StatTile styles={DESERT_STYLES.covered} value={summary.covered} caption="Covered" total={totalPins} />
                <StatTile styles={DESERT_STYLES.medical_desert} value={summary.medical_desert} caption="Medical desert" total={totalPins} />
                <StatTile styles={DESERT_STYLES.data_desert} value={summary.data_desert} caption="Data desert" total={totalPins} />
              </div>

              {/* Drill-through */}
              <div className="card overflow-hidden animate-fade-up" style={{ animationDelay: '100ms' }}>
                <div className="card-header">
                  <h2 className="section-title">
                    {selectedCell ? `PIN ${selectedCell.pincode} · ${selectedCell.district ?? 'Unknown district'}` : 'Facility drill-through'}
                  </h2>
                  {selectedCell && (
                    <span className={`chip ${DESERT_STYLES[selectedCell.desert_state].chip}`}>
                      {DESERT_STYLES[selectedCell.desert_state].label}
                    </span>
                  )}
                </div>

                <div className="p-4 sm:p-5">
                  {!selectedCell && (
                    <div className="py-8 text-center">
                      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-sky-500">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </div>
                      <p className="text-sm text-slate-500 max-w-[16rem] mx-auto leading-relaxed">
                        Select a point on the map to inspect the facilities behind it.
                      </p>
                    </div>
                  )}

                  {selectedCell && drillStatus === 'loading' && (
                    <div className="space-y-2">
                      {[0, 1].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
                    </div>
                  )}
                  {selectedCell && drillStatus === 'error' && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">{drillError}</div>
                  )}
                  {selectedCell && drillStatus === 'done' && drillFacilities.length === 0 && (
                    <p className="text-sm text-slate-500 py-4">
                      No facility has a machine assessment for this capability in this pincode.
                    </p>
                  )}
                  {selectedCell && drillStatus === 'done' && drillFacilities.length > 0 && (
                    <ul className="space-y-3 max-h-[520px] overflow-y-auto -mr-1 pr-1">
                      {drillFacilities.map((f, i) => (
                        <li
                          key={f.facility_id}
                          className="rounded-xl border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_2px_rgba(16,42,67,0.03)] animate-slide-in"
                          style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <Link href={`/facility/${f.facility_id}`} className="text-sm font-semibold text-slate-900 hover:text-sky-700 transition-colors break-words">
                              {f.name}
                            </Link>
                            <TrustBadge score={f.trust_score} showScore={false} />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className={`chip ${STATUS_STYLES[f.status] ?? STATUS_STYLES.no}`}>{f.status}</span>
                            <span className={`chip ${f.grounded ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                              {f.grounded ? 'grounded ✓' : 'ungrounded ✗'}
                            </span>
                          </div>
                          {f.evidence_sentence && (
                            <blockquote className="mt-2.5 border-l-2 border-sky-300 bg-sky-50/40 rounded-r-xl px-3 py-2 text-xs italic text-slate-600 leading-relaxed break-words">
                              &ldquo;{f.evidence_sentence}&rdquo;
                            </blockquote>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full pincode table */}
        {status === 'done' && cells.length > 0 && (
          <div className="card overflow-hidden mb-10 animate-fade-up">
            <div className="card-header">
              <h2 className="section-title">All pincodes · {cells.length}</h2>
            </div>
            <div className="p-4 sm:p-5 overflow-x-auto">
              {cellsTruncated && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  Showing the 500 highest-priority cells of {totalCells}. Summary counts cover ALL cells.
                </p>
              )}
              <table className="w-full text-sm border-collapse min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">PIN</th>
                    <th className="py-2 pr-3 font-medium">District</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 pr-3 font-medium">Desert state</th>
                    <th className="py-2 pr-3 font-medium text-right">Facilities</th>
                    <th className="py-2 pr-3 font-medium text-right">Yes</th>
                    <th className="py-2 pr-3 font-medium text-right">Trust-wt.</th>
                    <th className="py-2 pr-3 font-medium text-right">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map(cell => (
                    <tr
                      key={cell.pincode}
                      onClick={() => handleCellClick(cell)}
                      className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors hover:bg-sky-50/40 ${
                        selectedCell?.pincode === cell.pincode ? 'bg-sky-50/60' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs text-slate-700 tabular-nums">{cell.pincode}</td>
                      <td className="py-2 pr-3 text-slate-700">{cell.district ?? '—'}</td>
                      <td className="py-2 pr-3 text-slate-700">{cell.state ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <span className={`chip ${DESERT_STYLES[cell.desert_state].chip}`}>{DESERT_STYLES[cell.desert_state].label}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-700 text-right tabular-nums">{cell.facilities_in_pin}</td>
                      <td className="py-2 pr-3 text-slate-700 text-right tabular-nums">{cell.yes_count}</td>
                      <td className="py-2 pr-3 text-slate-700 text-right tabular-nums">{cell.trust_weighted_yes.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-slate-700 text-right tabular-nums">{Math.round((cell.avg_coverage ?? 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* My scenarios */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="section-title">My scenarios</h2>
            {scenarios.length > 0 && <span className="text-xs text-slate-400 tabular-nums">{scenarios.length}</span>}
          </div>
          <div className="p-4 sm:p-5">
            {scenariosError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs mb-3">{scenariosError}</div>
            )}
            {!scenariosError && scenariosLoaded && scenarios.length === 0 && (
              <p className="text-sm text-slate-500">
                No saved scenarios yet. Run an analysis above and hit &ldquo;Save scenario&rdquo; to keep it.
              </p>
            )}
            {scenarios.length > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {scenarios.map((s, i) => (
                  <li
                    key={s.id}
                    className="rounded-xl border border-slate-200/70 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,42,67,0.03)] animate-fade-up"
                    style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.capability ? (CAP_LABELS[s.capability] ?? s.capability) : 'any capability'}
                          {' · '}
                          {s.geo_level ? `${s.geo_level}: ${s.geo_value ?? '—'}` : 'All India'}
                          {' · '}
                          {new Date(s.created_at).toLocaleDateString()}
                        </p>
                        {s.note && <p className="text-xs text-slate-600 italic mt-1">&ldquo;{s.note}&rdquo;</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleLoadScenario(s)}
                          aria-label="Load scenario"
                          title="Load scenario"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-sky-700 hover:bg-sky-50 hover:border-sky-300 transition-colors"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteScenario(s.id)}
                          aria-label="Delete scenario"
                          title="Delete scenario"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-slate-600">
      <span className={`w-2.5 h-2.5 rounded-full ${className} ring-2 ring-white`} />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}

function StatTile({
  styles,
  value,
  caption,
  total,
}: {
  styles: { tile: string; num: string };
  value: number;
  caption: string;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`rounded-2xl border ${styles.tile} px-2 py-3 sm:px-3 sm:py-3.5 text-center`}>
      <div className={`text-xl sm:text-2xl font-bold tabular-nums leading-none ${styles.num}`}>{value}</div>
      <div className="text-[11px] font-medium text-slate-500 mt-1.5 leading-tight">{caption}</div>
      <div className="text-[10px] text-slate-400 tabular-nums mt-0.5">{pct}%</div>
    </div>
  );
}
