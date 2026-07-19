'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { TrustBadge } from '@/components/TrustBadge';
import { PRIMARY_CAPABILITIES, OTHER_CAPABILITIES } from '@/lib/trustdesk/types';
import type { DesertCell, DesertSummary } from '@/lib/desert/types';

const IndiaMap = dynamic(() => import('@/components/IndiaMap'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 shimmer" />,
});

type Status = 'loading' | 'error' | 'done';
type GeoLevelValue = 'state' | 'district' | 'pincode' | '';

interface DrillFacility {
  facility_id: string;
  name: string;
  facility_type: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  status: 'yes' | 'no' | 'unclear';
  evidence_sentence: string | null;
  grounded: boolean;
  trust_score: number | null;
}

const CAP_LABELS: Record<string, string> = Object.fromEntries(
  [...PRIMARY_CAPABILITIES, ...OTHER_CAPABILITIES].map(c => [c.value, c.label])
);

const DESERT_STYLES: Record<DesertCell['desert_state'], { chip: string; label: string; tile: string; num: string }> = {
  covered: {
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    label: 'Covered',
    tile: 'bg-emerald-50/70 border-emerald-100',
    num: 'text-emerald-700',
  },
  medical_desert: {
    chip: 'bg-rose-50 text-rose-800 border-rose-200',
    label: 'Medical desert',
    tile: 'bg-rose-50/70 border-rose-100',
    num: 'text-rose-700',
  },
  data_desert: {
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
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

export interface DesertResultProps {
  capability: string;
  geoLevel?: GeoLevelValue;
  geoValue?: string;
}

/**
 * Self-contained three-state coverage result for the chat thread. Fetches the existing
 * `/api/desert` endpoint and renders the same honest covered / medical-desert / data-desert
 * treatment (map + drill-through). The drill-through lists ALL facilities for the region by
 * default; clicking a map point narrows it to that pincode.
 */
export default function DesertResult({ capability, geoLevel = '', geoValue = '' }: DesertResultProps) {
  const [cells, setCells] = useState<DesertCell[]>([]);
  const [summary, setSummary] = useState<DesertSummary>({ covered: 0, medical_desert: 0, data_desert: 0 });
  const [totalCells, setTotalCells] = useState(0);
  const [cellsTruncated, setCellsTruncated] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const [selectedCell, setSelectedCell] = useState<DesertCell | null>(null);
  const [facilities, setFacilities] = useState<DrillFacility[]>([]);
  const [drillStatus, setDrillStatus] = useState<Status>('loading');
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillTruncated, setDrillTruncated] = useState(false);

  // Fetch the coverage cells for the map + summary.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus('loading');
      setError(null);
      setSelectedCell(null);
      try {
        const qs = new URLSearchParams({ capability });
        if (geoLevel) qs.set('geo_level', geoLevel);
        if (geoLevel && geoValue.trim()) qs.set('geo_value', geoValue.trim());

        const resp = await fetch(`/api/desert?${qs.toString()}`);
        const json = await resp.json();
        if (cancelled) return;
        if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);

        const nextCells = (json.cells ?? []) as DesertCell[];
        setCells(nextCells);
        setSummary((json.summary ?? { covered: 0, medical_desert: 0, data_desert: 0 }) as DesertSummary);
        setTotalCells(typeof json.total_cells === 'number' ? json.total_cells : nextCells.length);
        setCellsTruncated(Boolean(json.cells_truncated));
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [capability, geoLevel, geoValue]);

  // Load facilities — region-wide by default (cell = null), or one pincode when a point is clicked.
  const loadFacilities = useCallback(
    async (cell: DesertCell | null) => {
      setDrillStatus('loading');
      setDrillError(null);
      try {
        const qs = new URLSearchParams({ capability });
        if (cell) {
          qs.set('pincode', cell.pincode);
        } else {
          if (geoLevel) qs.set('geo_level', geoLevel);
          if (geoLevel && geoValue.trim()) qs.set('geo_value', geoValue.trim());
        }
        const resp = await fetch(`/api/desert/facilities?${qs.toString()}`);
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
        setFacilities((json.facilities ?? []) as DrillFacility[]);
        setDrillTruncated(Boolean(json.truncated));
        setDrillStatus('done');
      } catch (err) {
        setDrillError(err instanceof Error ? err.message : String(err));
        setDrillStatus('error');
      }
    },
    [capability, geoLevel, geoValue]
  );

  // Show all region facilities by default whenever the query changes.
  useEffect(() => {
    void loadFacilities(null);
  }, [loadFacilities]);

  const handleCellClick = useCallback(
    (cell: DesertCell) => {
      setSelectedCell(cell);
      void loadFacilities(cell);
    },
    [loadFacilities]
  );

  const backToAll = useCallback(() => {
    setSelectedCell(null);
    void loadFacilities(null);
  }, [loadFacilities]);

  const capLabel = CAP_LABELS[capability] ?? capability;
  const regionLabel = geoValue.trim() || 'All India';

  if (status === 'loading') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
        <div className="h-[420px] rounded-2xl shimmer" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
        Something went wrong: {error}
      </div>
    );
  }

  if (cells.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600 text-center">
        No pincodes matched {capLabel} for this region. Try a broader geography — sparse records are
        not the same as no care.
      </div>
    );
  }

  const mapCells = cells.filter(c => c.lat != null && c.lng != null);
  const noCoordCount = cells.length - mapCells.length;
  const totalPins = summary.covered + summary.medical_desert + summary.data_desert;

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile styles={DESERT_STYLES.covered} value={summary.covered} caption="Covered" total={totalPins} />
        <StatTile styles={DESERT_STYLES.medical_desert} value={summary.medical_desert} caption="Medical desert" total={totalPins} />
        <StatTile styles={DESERT_STYLES.data_desert} value={summary.data_desert} caption="Data desert" total={totalPins} />
      </div>

      <CoverageBar covered={summary.covered} medical={summary.medical_desert} data={summary.data_desert} />

      {cellsTruncated && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Showing the {mapCells.length} highest-priority cells of {totalCells}. Summary counts cover ALL cells.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* LEFT — map */}
        <div className="relative h-[420px] lg:h-[560px] rounded-2xl overflow-hidden border border-slate-200/70 shadow-[0_1px_2px_rgba(16,42,67,0.04)]">
          <IndiaMap cells={mapCells} selectedPincode={selectedCell?.pincode ?? null} onSelect={handleCellClick} />
          <div className="absolute top-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm border border-slate-200/70">
            {capLabel} · {mapCells.length} pincode{mapCells.length === 1 ? '' : 's'}
          </div>
          {noCoordCount > 0 && (
            <div className="absolute bottom-3 right-3 z-10 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[11px] text-slate-500 shadow-sm border border-slate-200/70">
              {noCoordCount} without coordinates
            </div>
          )}
        </div>

        {/* RIGHT — drill-through */}
        <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden flex flex-col max-h-[420px] lg:h-[560px]">
          <div className="card-header shrink-0">
            <div className="min-w-0">
              <h3 className="section-title truncate">
                {selectedCell ? `PIN ${selectedCell.pincode} · ${selectedCell.district ?? 'Unknown district'}` : 'Facility drill-through'}
              </h3>
              {!selectedCell && (
                <p className="text-[11px] text-slate-400 mt-0.5">All facilities · {capLabel} · {regionLabel}</p>
              )}
            </div>
            {selectedCell ? (
              <button onClick={backToAll} className="chip hover:bg-slate-50 transition-colors shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
                All facilities
              </button>
            ) : (
              drillStatus === 'done' && facilities.length > 0 && (
                <span className="chip bg-sky-50 text-sky-700 border-sky-200 shrink-0 tabular-nums">{facilities.length}{drillTruncated ? '+' : ''}</span>
              )
            )}
          </div>

          <div className="p-4 flex-1 overflow-y-auto nice-scroll">
            {drillStatus === 'loading' && (
              <div className="space-y-2">
                {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
              </div>
            )}
            {drillStatus === 'error' && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">{drillError}</div>
            )}
            {drillStatus === 'done' && facilities.length === 0 && (
              <p className="text-sm text-slate-500 py-4">
                {selectedCell
                  ? `No facility has a machine assessment for ${capLabel} in this pincode.`
                  : `No facility offers ${capLabel} with a confident or unclear assessment in ${regionLabel} yet.`}
              </p>
            )}
            {drillStatus === 'done' && facilities.length > 0 && (
              <>
                <DrillCharts facilities={facilities} scopeLabel={selectedCell ? `PIN ${selectedCell.pincode}` : regionLabel} />
                <ul className="space-y-3">
                {facilities.map((f, i) => (
                  <li
                    key={f.facility_id}
                    className="rounded-xl border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_2px_rgba(16,42,67,0.03)] animate-slide-in"
                    style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/facility/${f.facility_id}`} className="text-sm font-semibold text-slate-900 hover:text-sky-700 transition-colors break-words">
                          {f.name}
                        </Link>
                        {!selectedCell && (f.city || f.state || f.pincode) && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {[f.city, f.state, f.pincode].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <TrustBadge score={f.trust_score} showScore={false} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className={`chip ${STATUS_STYLES[f.status] ?? STATUS_STYLES.no}`}>{f.status}</span>
                      <span className={`chip ${f.grounded ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {f.grounded ? 'grounded ✓' : 'ungrounded ✗'}
                      </span>
                      {f.facility_type && <span className="chip">{f.facility_type}</span>}
                    </div>
                    {f.evidence_sentence && (
                      <blockquote className="mt-2.5 border-l-2 border-sky-300 bg-sky-50/40 rounded-r-xl px-3 py-2 text-xs italic text-slate-600 leading-relaxed break-words">
                        &ldquo;{f.evidence_sentence}&rdquo;
                      </blockquote>
                    )}
                  </li>
                ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 leading-snug">
        Data desert = facilities exist but records are too sparse to judge. Not the same as no care.
      </p>
    </div>
  );
}

/** Three-state coverage proportion bar (covered / medical desert / data desert). */
function CoverageBar({ covered, medical, data }: { covered: number; medical: number; data: number }) {
  const total = covered + medical + data || 1;
  const pct = (v: number) => `${(v / total) * 100}%`;
  const segs = [
    { label: 'Covered', value: covered, color: '#10b981' },
    { label: 'Medical desert', value: medical, color: '#f43f5e' },
    { label: 'Data desert', value: data, color: '#94a3b8' },
  ];
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 gap-[2px]">
        {segs.filter(s => s.value > 0).map(s => (
          <div key={s.label} className="h-full" style={{ width: pct(s.value), backgroundColor: s.color }} title={`${s.label}: ${s.value} of ${total}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-500">
        {segs.map(s => (
          <span key={s.label} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label} {s.value}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Charts for the facilities currently in the drill panel. Recomputes automatically
 * when the scope narrows from the whole region to a single clicked pincode, so the
 * graphs always reflect the location in view. Status colors are reserved + labeled.
 */
function DrillCharts({ facilities, scopeLabel }: { facilities: DrillFacility[]; scopeLabel: string }) {
  const n = facilities.length;
  const denom = n || 1;
  const score = (f: DrillFacility) => f.trust_score ?? 0;
  const high = facilities.filter(f => score(f) >= 0.75).length;
  const medium = facilities.filter(f => score(f) >= 0.5 && score(f) < 0.75).length;
  const low = facilities.filter(f => score(f) < 0.5).length;
  const yes = facilities.filter(f => f.status === 'yes').length;
  const unclear = facilities.filter(f => f.status === 'unclear').length;
  const no = facilities.filter(f => f.status === 'no').length;

  const bands = [
    { label: 'High', count: high, color: '#10b981' },
    { label: 'Medium', count: medium, color: '#f59e0b' },
    { label: 'Low', count: low, color: '#f43f5e' },
  ];
  const statusSegs = [
    { label: 'Confirmed', value: yes, color: '#10b981' },
    { label: 'Unclear', value: unclear, color: '#f59e0b' },
    { label: 'Not indicated', value: no, color: '#94a3b8' },
  ];
  const pct = (v: number) => `${(v / denom) * 100}%`;

  return (
    <div className="mb-4 rounded-xl border border-slate-200/70 bg-sky-50/30 p-3 space-y-3">
      <div className="text-[11px] text-slate-500">Insights for <span className="font-semibold text-slate-700">{scopeLabel}</span> · {n} facilit{n === 1 ? 'y' : 'ies'}</div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Trust distribution</div>
        <div className="space-y-1">
          {bands.map(b => (
            <div key={b.label} className="flex items-center gap-2" title={`${b.label} trust: ${b.count} of ${n}`}>
              <span className="w-14 text-[11px] text-slate-500 shrink-0">{b.label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: pct(b.count), backgroundColor: b.color }} /></div>
              <span className="w-6 text-right text-[11px] font-semibold text-slate-700 tabular-nums">{b.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Assessment</div>
        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 gap-[2px]">
          {statusSegs.filter(s => s.value > 0).map(s => (
            <div key={s.label} className="h-full" style={{ width: pct(s.value), backgroundColor: s.color }} title={`${s.label}: ${s.value}`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-500">
          {statusSegs.filter(s => s.value > 0).map(s => (
            <span key={s.label} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label} {s.value}</span>
          ))}
        </div>
      </div>
    </div>
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
