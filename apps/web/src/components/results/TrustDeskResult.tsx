'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrustBadge } from '@/components/TrustBadge';
import { PRIMARY_CAPABILITIES, OTHER_CAPABILITIES, type TrustDeskResult as TrustDeskRow } from '@/lib/trustdesk/types';

const CAP_LABELS: Record<string, string> = Object.fromEntries(
  [...PRIMARY_CAPABILITIES, ...OTHER_CAPABILITIES].map(c => [c.value, c.label])
);

type Status = 'loading' | 'error' | 'done';

export interface TrustDeskResultProps {
  capability: string;
  state?: string;
  city?: string;
  pincode?: string;
}

/**
 * Self-contained ranked Trust Desk result for the chat thread. Fetches the existing
 * `/api/trust-desk` endpoint and renders the same evidence-cited result cards used on
 * the standalone Trust Desk page — no logic is re-derived on the client.
 */
export default function TrustDeskResult({ capability, state, city, pincode }: TrustDeskResultProps) {
  const [results, setResults] = useState<TrustDeskRow[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [region, setRegion] = useState('all regions');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus('loading');
      setError(null);
      setNotice(null);
      try {
        const qs = new URLSearchParams({ capability });
        if (state?.trim()) qs.set('state', state.trim());
        if (city?.trim()) qs.set('city', city.trim());
        if (pincode?.trim()) qs.set('pincode', pincode.trim());

        const resp = await fetch(`/api/trust-desk?${qs.toString()}`);
        const json = await resp.json();
        if (cancelled) return;
        if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);

        const rows: TrustDeskRow[] = json.results ?? [];
        setResults(rows);

        const applied = json.applied ?? {};
        const appliedRegion =
          [applied.city, applied.state, applied.pincode].filter(Boolean).join(', ') || 'all regions';
        setRegion(appliedRegion);

        const dropped: string[] = json.relaxed && Array.isArray(json.dropped) ? json.dropped : [];
        if (dropped.length > 0 && rows.length > 0) {
          const labels: Record<string, string> = {
            state: 'state',
            city: 'city',
            pincode: pincode ? `PIN ${pincode.trim()}` : 'pincode',
          };
          const droppedLabels = dropped.map(d => labels[d] ?? d).join(', ');
          setNotice(
            `No exact match for ${droppedLabels}. Showing ${CAP_LABELS[capability] ?? capability} facilities in ${appliedRegion} instead — narrow the region or check spelling.`
          );
        }
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [capability, state, city, pincode]);

  const capLabel = CAP_LABELS[capability] ?? capability;

  if (status === 'loading') {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-28 rounded-2xl shimmer" />
        ))}
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

  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600 text-center">
        No facilities matched {capLabel} in {region}. Try widening the region — absence of results
        here does NOT mean absence of care (data may be sparse).
      </div>
    );
  }

  const total = results.length;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden flex flex-col lg:max-h-[620px]">
      {/* Insights header */}
      <div className="border-b border-slate-100 bg-sky-50/40 p-4 shrink-0 space-y-3">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <span className="font-semibold text-slate-800 tabular-nums">{total}</span>
          <span className="text-slate-500">facilit{total === 1 ? 'y' : 'ies'}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-600">{capLabel}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-600">{region}</span>
        </div>

        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs flex items-start gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>{notice}</span>
          </div>
        )}

        <TrustCharts results={results} />
      </div>

      {/* Scrollable list */}
      <div className="p-4 flex-1 overflow-y-auto nice-scroll space-y-3">
        {results.map((r, i) => (
          <TrustResultCard key={r.facility_id} result={r} index={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Two compact, labeled charts for the Trust Desk insights header.
 * Colors are the reserved STATUS palette (emerald=good, amber=warning, rose=critical),
 * always paired with a text label + count so identity is never carried by color alone.
 */
function TrustCharts({ results }: { results: TrustDeskRow[] }) {
  const n = results.length;
  const denom = n || 1;
  const score = (r: TrustDeskRow) => r.trust_score ?? 0;

  const high = results.filter(r => score(r) >= 0.75).length;
  const medium = results.filter(r => score(r) >= 0.5 && score(r) < 0.75).length;
  const low = results.filter(r => score(r) < 0.5).length;
  const confirmed = results.filter(r => r.capability_status === 'yes').length;
  const unclear = n - confirmed;
  const grounded = results.filter(r => r.grounded).length;
  const verified = results.filter(r => r.effective.verified).length;
  const flagged = results.filter(r => r.hard_flag_count > 0).length;

  const bands = [
    { label: 'High', hint: '≥ 0.75', count: high, color: '#10b981' },
    { label: 'Medium', hint: '0.5–0.75', count: medium, color: '#f59e0b' },
    { label: 'Low', hint: '< 0.5', count: low, color: '#f43f5e' },
  ];
  const pct = (v: number) => `${Math.round((v / denom) * 100)}%`;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
      {/* Trust distribution — magnitude by trust band */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Trust distribution</div>
        <div className="space-y-1.5">
          {bands.map(b => (
            <div key={b.label} className="flex items-center gap-2" title={`${b.label} trust (${b.hint}): ${b.count} of ${n}`}>
              <span className="w-14 text-[11px] text-slate-500 shrink-0">{b.label}</span>
              <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: pct(b.count), backgroundColor: b.color }} />
              </div>
              <span className="w-6 text-right text-[11px] font-semibold text-slate-700 tabular-nums">{b.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Assessment mix — confirmed vs unclear proportion */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Assessment</div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 gap-[2px]">
          <div className="h-full" style={{ width: pct(confirmed), backgroundColor: '#10b981' }} title={`Confirmed: ${confirmed}`} />
          <div className="h-full" style={{ width: pct(unclear), backgroundColor: '#f59e0b' }} title={`Unclear: ${unclear}`} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#10b981' }} />Confirmed {confirmed}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#f59e0b' }} />Unclear {unclear}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="chip bg-sky-50 text-sky-700 border-sky-200 py-0.5">{grounded}/{n} grounded</span>
          {verified > 0 && <span className="chip bg-teal-50 text-teal-700 border-teal-200 py-0.5">{verified} verified</span>}
          {flagged > 0 && <span className="chip bg-amber-50 text-amber-800 border-amber-200 py-0.5">{flagged} flagged</span>}
        </div>
      </div>
    </div>
  );
}

function TrustResultCard({ result, index }: { result: TrustDeskRow; index: number }) {
  const confirmed = result.capability_status === 'yes';
  const verifiedYes = result.effective.verified && result.effective.status === 'yes';
  const verifiedNo = result.effective.verified && result.effective.status === 'no';

  return (
    <div
      className={`card card-interactive p-4 sm:p-5 animate-fade-up ${verifiedYes ? 'ring-1 ring-teal-300 border-teal-200' : ''} ${verifiedNo ? 'opacity-80' : ''}`}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <Link href={`/facility/${result.facility_id}`} className="text-lg font-semibold text-slate-900 hover:text-sky-700 transition-colors break-words">
            {result.name}
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {result.facility_type && <span className="chip">{result.facility_type}</span>}
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {[result.city, result.state, result.pincode].filter(Boolean).join(', ') || 'Location unknown'}
            </span>
          </div>
        </div>
        <TrustBadge score={result.trust_score} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        {verifiedYes && (
          <span className="chip bg-teal-50 text-teal-800 border-teal-300 font-semibold">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            verified
          </span>
        )}
        {verifiedNo && (
          <span className="chip bg-slate-100 text-slate-600 border-slate-300 font-semibold">Human-verified: not available</span>
        )}
        <span
          className={`chip ${confirmed ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'} ${!result.grounded || verifiedNo ? 'line-through opacity-70' : ''}`}
        >
          {confirmed ? 'confirmed' : 'unclear'}
        </span>
        {!result.grounded && <span className="chip bg-slate-100 text-slate-500">ungrounded</span>}
        {result.hard_flag_count > 0 && (
          <span className="chip bg-amber-50 text-amber-800 border-amber-200">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            {result.hard_flag_count} flag{result.hard_flag_count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {result.effective.verified && (
        <p className="text-xs text-slate-500 mb-2">
          by {result.effective.by}
          {result.effective.at ? ` · ${new Date(result.effective.at).toLocaleDateString()}` : ''}
          {result.effective.note ? ` — "${result.effective.note}"` : ''}
        </p>
      )}

      {result.evidence_sentence && (
        <blockquote className="border-l-2 border-sky-300 bg-sky-50/40 rounded-r-xl px-3.5 py-2.5 text-sm italic text-slate-600 leading-relaxed break-words">
          &ldquo;{result.evidence_sentence}&rdquo;
          {result.source_field && <span className="ml-2 not-italic text-xs text-slate-400">— {result.source_field}</span>}
        </blockquote>
      )}
    </div>
  );
}
