'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { TrustBadge } from '@/components/TrustBadge';
import Select, { type SelectOption } from '@/components/Select';
import { PRIMARY_CAPABILITIES, OTHER_CAPABILITIES, type TrustDeskResult } from '@/lib/trustdesk/types';

type Status = 'idle' | 'loading' | 'error' | 'done';

const CAP_LABELS: Record<string, string> = Object.fromEntries(
  [...PRIMARY_CAPABILITIES, ...OTHER_CAPABILITIES].map(c => [c.value, c.label])
);

const CAP_OPTIONS: SelectOption[] = [
  ...PRIMARY_CAPABILITIES.map(c => ({ value: c.value, label: c.label, group: 'Common' })),
  ...OTHER_CAPABILITIES.map(c => ({ value: c.value, label: c.label, group: 'All capabilities' })),
];

export default function TrustDeskPage() {
  const [capability, setCapability] = useState('icu');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [results, setResults] = useState<TrustDeskResult[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [echo, setEcho] = useState<{ capability: string; region: string }>({ capability: 'ICU', region: 'All India' });
  const [notice, setNotice] = useState<string | null>(null);

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    setStatus('loading');
    setError(null);
    try {
      const qs = new URLSearchParams({ capability });
      if (state.trim()) qs.set('state', state.trim());
      if (city.trim()) qs.set('city', city.trim());
      if (pincode.trim()) qs.set('pincode', pincode.trim());

      const resp = await fetch(`/api/trust-desk?${qs.toString()}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setResults(json.results ?? []);

      const applied = json.applied ?? {};
      const appliedRegion = [applied.city, applied.state, applied.pincode].filter(Boolean).join(', ') || 'all regions';
      setEcho({ capability: CAP_LABELS[capability] ?? capability, region: appliedRegion });

      // "We widened your search" note when the exact filters matched nothing.
      const dropped: string[] = json.relaxed && Array.isArray(json.dropped) ? json.dropped : [];
      if (dropped.length > 0 && (json.results ?? []).length > 0) {
        const labels: Record<string, string> = { state: 'state', city: 'city', pincode: `PIN ${pincode.trim()}` };
        const droppedLabels = dropped.map(d => labels[d] ?? d).join(', ');
        setNotice(`No exact match for ${droppedLabels}. Showing ${CAP_LABELS[capability] ?? capability} facilities in ${appliedRegion} instead — widen or check spelling to narrow.`);
      } else {
        setNotice(null);
      }
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  return (
    <main className="hero-bg min-h-[calc(100vh-64px)]">
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
        <div className="animate-fade-up max-w-2xl">
          <span className="chip chip-sky mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            <span>Facility Trust Desk</span>
          </span>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-[1.1] mb-3">
            Can this facility actually do what it claims?
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-8">
            Pick a capability and a region. Every match is ranked by trust score and backed by a cited
            evidence sentence — not just a checkbox.
          </p>
        </div>

        <form onSubmit={runSearch} className="card p-4 sm:p-5 mb-8 animate-fade-up" style={{ animationDelay: '40ms' }}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              <span>Capability</span>
              <Select value={capability} onChange={setCapability} options={CAP_OPTIONS} label="Capability" />
            </div>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              State
              <input
                type="text"
                value={state}
                onChange={e => setState(e.target.value)}
                placeholder="e.g. Maharashtra"
                className="field"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              City
              <input
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="e.g. Pune"
                className="field"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
              Pincode
              <input
                type="text"
                value={pincode}
                onChange={e => setPincode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="6 digits"
                inputMode="numeric"
                maxLength={6}
                className="field"
              />
            </label>
          </div>

          <button type="submit" className="btn-primary mt-4 w-full sm:w-auto" disabled={status === 'loading'}>
            {status === 'loading' ? 'Searching…' : 'Search'}
          </button>
        </form>

        {status === 'loading' && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="card h-28 shimmer" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm animate-fade-up">
            Something went wrong: {error}
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600 text-center animate-fade-up">
            No facilities matched. Try widening the region — absence of results here does NOT mean
            absence of care (data may be sparse).
          </div>
        )}

        {status === 'done' && notice && results.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm mb-3 animate-fade-up flex items-start gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>{notice}</span>
          </div>
        )}

        {status === 'done' && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 mb-1 animate-fade-up">
              <span className="font-semibold text-slate-700 tabular-nums">{results.length}</span> facilit{results.length === 1 ? 'y' : 'ies'}
              <span className="mx-1.5 text-slate-300">·</span>{echo.capability}
              <span className="mx-1.5 text-slate-300">·</span>{echo.region}
            </p>
            {results.map((r, i) => (
              <ResultCard key={r.facility_id} result={r} index={i} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ResultCard({ result, index }: { result: TrustDeskResult; index: number }) {
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
