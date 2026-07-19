'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TrustBadge } from '@/components/TrustBadge';
import { effectiveStatus, type EffectiveStatus } from '@/lib/trustdesk/effective_status';
import type { FacilityDetail, FacilityOverride } from '@/lib/trustdesk/types';

const CAP_LABELS: Record<string, string> = {
  icu: 'ICU',
  emergency_24x7: '24/7 ER',
  trauma_center: 'Trauma center',
  ambulance: 'Ambulance',
  general_surgery: 'General surgery',
  cardiac_surgery: 'Cardiac surgery',
  orthopedic_surgery: 'Orthopedic surgery',
  anesthesiology_staff: 'Anesthesiology',
  oncology: 'Oncology',
  dialysis: 'Dialysis',
  cardiology: 'Cardiology',
  neurology: 'Neurology',
  pediatrics: 'Pediatrics',
  obstetrics_gynecology: 'OB-GYN / Maternity',
  neonatal_nicu: 'NICU',
  ct_scan: 'CT scan',
  mri: 'MRI',
  ultrasound: 'Ultrasound',
  pathology_lab: 'Pathology lab',
  ventilator: 'Ventilator',
  oxygen_supply: 'Oxygen supply',
};

function truncate(url: string, max = 52): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

const STATUS_STYLES: Record<string, string> = {
  yes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  unclear: 'bg-amber-50 text-amber-800 border-amber-200',
  no: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_DOT: Record<string, string> = {
  yes: 'bg-emerald-500',
  unclear: 'bg-amber-500',
  no: 'bg-slate-400',
};

const VERDICT_STYLES: Record<string, string> = {
  yes: 'bg-teal-50 text-teal-800 border-teal-300',
  unclear: 'bg-amber-50 text-amber-800 border-amber-300',
  no: 'bg-slate-100 text-slate-700 border-slate-300',
};

const VERDICTS: { value: 'yes' | 'no' | 'unclear'; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unclear', label: 'Unclear' },
];

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export default function FacilityDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'done'>('loading');
  const [error, setError] = useState<string | null>(null);

  const [overrides, setOverrides] = useState<FacilityOverride[]>([]);
  const [you, setYou] = useState<string>('local-dev');

  const loadOverrides = useCallback(async () => {
    try {
      const resp = await fetch(`/api/overrides?facility_id=${encodeURIComponent(id)}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setOverrides((json.overrides ?? []) as FacilityOverride[]);
      setYou((json.you ?? 'local-dev') as string);
    } catch {
      // Overrides are a layer on top of the machine assessment — if this fails,
      // the page still functions fine showing machine-only data.
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([
      fetch(`/api/facility/${id}`).then(async resp => {
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
        return json as FacilityDetail;
      }),
      loadOverrides(),
    ])
      .then(([detailJson]) => {
        if (cancelled) return;
        setDetail(detailJson);
        setStatus('done');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id, loadOverrides]);

  const overridesByCapability = useMemo(() => {
    const map = new Map<string, FacilityOverride[]>();
    for (const o of overrides) {
      const list = map.get(o.capability) ?? [];
      list.push(o);
      map.set(o.capability, list);
    }
    return map;
  }, [overrides]);
  const verifiedCapabilityCount = overridesByCapability.size;

  const grouped = useMemo(() => {
    if (!detail) return { yes: [], unclear: [], no: [] } as Record<'yes' | 'unclear' | 'no', ReturnType<typeof buildRow>[]>;
    const rows = detail.capabilities.map(c => {
      const rowOverrides = overridesByCapability.get(c.capability) ?? [];
      const latest = rowOverrides[0] ?? null;
      const own = rowOverrides.find(o => o.app_user === you) ?? null;
      const eff = effectiveStatus({ status: c.status }, latest);
      return buildRow(c, eff, own);
    });
    return {
      yes: rows.filter(r => r.eff.status === 'yes'),
      unclear: rows.filter(r => r.eff.status === 'unclear'),
      no: rows.filter(r => r.eff.status === 'no'),
    };
  }, [detail, overridesByCapability, you]);

  const [showNo, setShowNo] = useState(false);

  return (
    <main className="hero-bg min-h-[calc(100vh-64px)]">
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-16">
        <Link href="/trust-desk" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 mb-6 transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Trust Desk
        </Link>

        {status === 'loading' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 card h-80 shimmer" />
            <div className="lg:col-span-8 space-y-5">
              <div className="card h-28 shimmer" />
              <div className="card h-64 shimmer" />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm animate-fade-up">
            Something went wrong: {error}
          </div>
        )}

        {status === 'done' && detail && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT — sticky summary */}
            <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
              <div className="card p-5 sm:p-6 animate-fade-up">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2 leading-tight break-words">{detail.name}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  {detail.facility_type && <span className="chip">{detail.facility_type}</span>}
                  <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {[detail.city, detail.state, detail.pincode].filter(Boolean).join(', ') || 'Location unknown'}
                  </span>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <TrustBadge score={detail.trust_score} />
                  {/* Coverage bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                      <span>Data coverage</span>
                      <span className="tabular-nums font-medium text-slate-700">{Math.round((detail.coverage_score ?? 0) * 100)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-[width] duration-500"
                        style={{ width: `${Math.round((detail.coverage_score ?? 0) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {detail.description && (
                  <p className="mt-4 text-sm text-slate-600 leading-relaxed">{detail.description}</p>
                )}
                {detail.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {detail.specialties.map((s, i) => (
                      <span key={i} className="chip">{s}</span>
                    ))}
                  </div>
                )}

                {/* Contact + stats */}
                {(detail.official_website || detail.official_phone || detail.number_doctors != null || detail.capacity != null || detail.year_established != null) && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2 text-sm">
                    {detail.official_website && (
                      <a href={detail.official_website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sky-700 hover:text-sky-900 transition-colors">
                        <ExternalLinkIcon />
                        <span className="truncate">{truncate(detail.official_website)}</span>
                      </a>
                    )}
                    {detail.official_phone && (
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-slate-400">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.02a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92Z" />
                        </svg>
                        {detail.official_phone}
                      </div>
                    )}
                    {(detail.number_doctors != null || detail.capacity != null || detail.year_established != null) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 tabular-nums">
                        {detail.number_doctors != null && <span>{detail.number_doctors} doctors</span>}
                        {detail.capacity != null && <span>Capacity {detail.capacity}</span>}
                        {detail.year_established != null && <span>Est. {detail.year_established}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* Provenance / sources */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="section-title mb-2">Sources</p>
                  {detail.source_urls.length > 0 ? (
                    <ul className="space-y-1.5">
                      {detail.source_urls.map((url, i) => (
                        <li key={i}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-sky-700 hover:text-sky-900 transition-colors break-all">
                            <ExternalLinkIcon />
                            <span className="break-all">{truncate(url)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs italic text-slate-400">No source URLs on file.</p>
                  )}
                </div>
              </div>
            </aside>

            {/* RIGHT — sections */}
            <div className="lg:col-span-8 space-y-5">
              {/* Why this trust score */}
              <div className="card overflow-hidden animate-fade-up" style={{ animationDelay: '40ms' }}>
                <div className="card-header">
                  <h2 className="section-title">Why this trust score</h2>
                </div>
                <div className="p-4 sm:p-5">
                  {detail.hard_flags.length === 0 ? (
                    <span className="chip bg-emerald-50 text-emerald-800 border-emerald-200">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      No contradictions detected
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {detail.hard_flags.map((f, i) => (
                        <span key={i} className="chip bg-rose-50 text-rose-800 border-rose-200">
                          {f.rule} (−{f.penalty})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Human verification */}
              <div id="override-panel" className="card overflow-hidden animate-fade-up" style={{ animationDelay: '80ms' }}>
                <div className="card-header">
                  <h2 className="section-title">Human verification</h2>
                  {verifiedCapabilityCount > 0 && (
                    <span className="chip chip-sky tabular-nums">{verifiedCapabilityCount} verified</span>
                  )}
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-sm text-slate-600 mb-3">
                    {verifiedCapabilityCount === 0
                      ? 'No capabilities verified on this facility yet — use "Verify" on a capability below to record what you learned.'
                      : `${verifiedCapabilityCount} capabilit${verifiedCapabilityCount === 1 ? 'y' : 'ies'} verified on this facility.`}
                  </p>
                  {overrides.length > 0 && (
                    <ul className="space-y-2">
                      {overrides.map(o => (
                        <li key={o.id} className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-800">{CAP_LABELS[o.capability] ?? o.capability}</span>
                            <span className={`chip ${VERDICT_STYLES[o.human_verdict] ?? VERDICT_STYLES.no}`}>{o.human_verdict}</span>
                            <span className="text-xs text-slate-500">by {o.app_user} · {new Date(o.updated_at).toLocaleDateString()}</span>
                          </div>
                          {o.note && <p className="text-xs text-slate-600 italic mt-1">&ldquo;{o.note}&rdquo;</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Capabilities & evidence */}
              <div className="card overflow-hidden animate-fade-up" style={{ animationDelay: '120ms' }}>
                <div className="card-header">
                  <h2 className="section-title">Capabilities &amp; evidence</h2>
                  <span className="text-xs text-slate-400 tabular-nums">{detail.capabilities.length} total</span>
                </div>
                <div className="p-4 sm:p-5 space-y-6">
                  {grouped.yes.length > 0 && (
                    <CapabilityGroup title="Confirmed" dot="bg-emerald-500" count={grouped.yes.length}>
                      {grouped.yes.map((row, i) => (
                        <CapabilityCard key={row.c.capability} row={row} index={i} facilityId={detail.facility_id} trustScore={detail.trust_score} onChanged={loadOverrides} />
                      ))}
                    </CapabilityGroup>
                  )}

                  {grouped.unclear.length > 0 && (
                    <CapabilityGroup title="Unclear" dot="bg-amber-500" count={grouped.unclear.length}>
                      {grouped.unclear.map((row, i) => (
                        <CapabilityCard key={row.c.capability} row={row} index={i} facilityId={detail.facility_id} trustScore={detail.trust_score} onChanged={loadOverrides} />
                      ))}
                    </CapabilityGroup>
                  )}

                  {grouped.no.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowNo(v => !v)}
                        aria-expanded={showNo}
                        className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3.5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100/70 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-slate-400" />
                          Not indicated ({grouped.no.length})
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition-transform duration-300 ${showNo ? 'rotate-180' : ''}`}>
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      <div className={`grid transition-all duration-300 ${showNo ? 'grid-rows-[1fr] mt-3' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-3">
                            {grouped.no.map((row, i) => (
                              <CapabilityCard key={row.c.capability} row={row} index={i} facilityId={detail.facility_id} trustScore={detail.trust_score} onChanged={loadOverrides} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

type Capability = FacilityDetail['capabilities'][number];

function buildRow(c: Capability, eff: EffectiveStatus, own: FacilityOverride | null) {
  return { c, eff, own };
}

function CapabilityGroup({ title, dot, count, children }: { title: string; dot: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        <span className="text-xs text-slate-400 tabular-nums">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function CapabilityCard({
  row,
  index,
  facilityId,
  trustScore,
  onChanged,
}: {
  row: ReturnType<typeof buildRow>;
  index: number;
  facilityId: string;
  trustScore: number;
  onChanged: () => void | Promise<void>;
}) {
  const { c: capability, eff: effective, own } = row;
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<'yes' | 'no' | 'unclear'>(capability.status);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openForm() {
    setVerdict(own?.human_verdict ?? capability.status);
    setNote(own?.note ?? '');
    setSaveError(null);
    setOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: facilityId,
          capability: capability.capability,
          human_verdict: verdict,
          note: note.trim() ? note.trim() : null,
          machine_status: capability.status,
          machine_score: trustScore,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setOpen(false);
      await onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/overrides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, capability: capability.capability }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Request failed (${resp.status})`);
      setOpen(false);
      await onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-3.5 sm:p-4 animate-fade-up ${effective.verified ? 'border-teal-200 ring-1 ring-teal-100' : 'border-slate-200/70'}`}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[capability.status] ?? STATUS_DOT.no}`} />
          <span className="font-semibold text-slate-800">{CAP_LABELS[capability.capability] ?? capability.capability}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {effective.verified && (
            <span className={`chip font-semibold ${VERDICT_STYLES[effective.status] ?? VERDICT_STYLES.no}`}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Human-verified: {effective.status}
            </span>
          )}
          <span className={`chip ${STATUS_STYLES[capability.status] ?? STATUS_STYLES.no} ${effective.verified ? 'opacity-60' : ''}`}>
            {effective.verified ? `machine: ${capability.status}` : capability.status}
          </span>
        </div>
      </div>

      {effective.verified && (
        <p className="text-xs text-slate-500 mt-1.5 pl-4">
          by {effective.by}
          {effective.at ? ` · ${new Date(effective.at).toLocaleDateString()}` : ''}
          {effective.note ? ` — “${effective.note}”` : ''}
        </p>
      )}

      {capability.evidence_sentence && (
        <blockquote className="mt-2.5 border-l-2 border-sky-300 bg-sky-50/40 rounded-r-xl px-3.5 py-2.5 text-sm italic text-slate-600 leading-relaxed break-words">
          &ldquo;{capability.evidence_sentence}&rdquo;
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {capability.source_field && <span className="chip">{capability.source_field}</span>}
        <span className={`chip ${capability.grounded ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {capability.grounded ? 'grounded ✓' : 'ungrounded ✗'}
        </span>
        <button
          type="button"
          onClick={openForm}
          disabled={open}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 hover:border-sky-300 transition-colors disabled:opacity-50"
        >
          {own ? 'Edit verdict' : 'Verify / Override'}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSave} className="mt-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3 sm:p-4 space-y-3 animate-fade-up">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-semibold text-slate-600">Your verdict:</span>
            {VERDICTS.map(v => (
              <label key={v.value} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`verdict-${capability.capability}`}
                  value={v.value}
                  checked={verdict === v.value}
                  onChange={() => setVerdict(v.value)}
                  className="accent-sky-600"
                />
                {v.label}
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note — how did you verify this? (e.g. called facility, site visit, official doc)"
            rows={2}
            className="field"
          />
          {saveError && <p className="text-xs text-rose-700">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            {own && (
              <button type="button" onClick={handleRemove} disabled={saving} className="ml-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
                Remove my verdict
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
