'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import DesertResult from '@/components/results/DesertResult';
import TrustDeskResult from '@/components/results/TrustDeskResult';
import { PRIMARY_CAPABILITIES, OTHER_CAPABILITIES } from '@/lib/trustdesk/types';
import type { Scenario } from '@/lib/desert/types';

const CAP_LABELS: Record<string, string> = Object.fromEntries(
  [...PRIMARY_CAPABILITIES, ...OTHER_CAPABILITIES].map(c => [c.value, c.label])
);

type View = 'desert' | 'trust_desk';
type GeoLevel = 'state' | 'district' | 'pincode' | '' | null;

interface TabConfig {
  id: View;
  label: string;
  track: string;
  heading: string;
  sub: string;
  suggestions: string[];
}

const TABS: TabConfig[] = [
  {
    id: 'desert',
    label: 'Medical Desert',
    track: 'medical_desert_planner',
    heading: 'Medical Desert Planner',
    sub: 'Find trust-weighted coverage gaps across India — covered, medical desert, or data desert.',
    suggestions: ['ICU coverage gaps in Bihar', 'Dialysis deserts in Rajasthan', 'Maternity gaps in Bihar', 'Oncology coverage in Maharashtra'],
  },
  {
    id: 'trust_desk',
    label: 'Facility Trust Desk',
    track: 'facility_trust_desk',
    heading: 'Facility Trust Desk',
    sub: 'Verify what a facility can actually do — ranked by trust, backed by cited evidence.',
    suggestions: ['Oncology in Delhi', 'ICU facilities in Maharashtra', 'Cardiac surgery in Pune', 'Trauma centers in Uttar Pradesh'],
  },
];

const TAB_BY_ID: Record<View, TabConfig> = { desert: TABS[0], trust_desk: TABS[1] };

interface Intent {
  view: View;
  capability: string;
  geo_level: GeoLevel;
  geo_value: string | null;
  note?: string;
}

type Turn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; kind: 'thinking' }
  | { id: string; role: 'assistant'; kind: 'clarify'; text: string }
  | { id: string; role: 'assistant'; kind: 'result'; intent: Intent; saved?: boolean };

let _seq = 0;
const uid = () => `t${Date.now()}_${_seq++}`;

function AiMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-sm shrink-0 ${className}`}
      style={{ width: size + 12, height: size + 12 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12h3l2 5 4-14 2 9h4" />
      </svg>
    </span>
  );
}

function TabIcon({ id, size = 14 }: { id: View; size?: number }) {
  return id === 'desert' ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function geoLabel(intent: Intent): string {
  return intent.geo_value ? intent.geo_value : 'All India';
}

export default function AskPage() {
  const [activeTab, setActiveTab] = useState<View>('desert');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const tab = TAB_BY_ID[activeTab];

  const loadScenarios = useCallback(async () => {
    try {
      const resp = await fetch('/api/scenarios');
      const json = await resp.json();
      if (resp.ok) setScenarios((json.scenarios ?? []) as Scenario[]);
    } catch {
      /* sidebar is non-critical */
    } finally {
      setScenariosLoaded(true);
    }
  }, []);

  useEffect(() => { void loadScenarios(); }, [loadScenarios]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  // Warm the Databricks warehouse ONCE when the app opens.
  // Deliberately NOT on an interval: a periodic ping keeps resetting the warehouse
  // idle timer (auto_stop_mins=10), so it never auto-stops and burns through the
  // Free Edition daily compute credit. execSql already retries cold starts.
  useEffect(() => {
    void fetch('/api/keepwarm').catch(() => {});
  }, []);

  const switchTab = useCallback((id: View) => {
    setActiveTab(id);
    setTurns([]);
    setInput('');
    setSidebarOpen(false);
  }, []);

  const submitQuery = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    const thinkingId = uid();
    const forcedView = activeTab; // the active tab decides which track the query runs against
    setTurns(prev => [
      ...prev,
      { id: uid(), role: 'user', text: q },
      { id: thinkingId, role: 'assistant', kind: 'thinking' },
    ]);

    try {
      const resp = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const json = await resp.json();
      setTurns(prev =>
        prev.map(t => {
          if (t.id !== thinkingId) return t;
          if (json.ok) {
            const intent: Intent = {
              view: forcedView,
              capability: json.capability,
              geo_level: json.geo_level ?? null,
              geo_value: json.geo_value ?? null,
              note: json.note,
            };
            return { id: t.id, role: 'assistant', kind: 'result', intent };
          }
          return {
            id: t.id,
            role: 'assistant',
            kind: 'clarify',
            text: json.clarify ?? json.error ?? 'I could not interpret that. Try naming a capability and a place, e.g. "dialysis in Bihar".',
          };
        })
      );
    } catch (err) {
      setTurns(prev =>
        prev.map(t =>
          t.id === thinkingId
            ? { id: t.id, role: 'assistant', kind: 'clarify', text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` }
            : t
        )
      );
    } finally {
      setBusy(false);
    }
  }, [busy, activeTab]);

  const saveScenario = useCallback(async (turnId: string, intent: Intent) => {
    const name = `${CAP_LABELS[intent.capability] ?? intent.capability} — ${geoLabel(intent)}`;
    setSavingId(turnId);
    try {
      const resp = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          track: TAB_BY_ID[intent.view].track,
          capability: intent.capability,
          geo_level: intent.geo_level || null,
          geo_value: intent.geo_value || null,
          filters_json: { view: intent.view, capability: intent.capability, geo_level: intent.geo_level || null, geo_value: intent.geo_value || null },
          snapshot_json: { view: intent.view },
          note: null,
        }),
      });
      if (resp.ok) {
        setTurns(prev => prev.map(t => (t.id === turnId && t.role === 'assistant' && t.kind === 'result' ? { ...t, saved: true } : t)));
        void loadScenarios();
      }
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  }, [loadScenarios]);

  const openScenario = useCallback((s: Scenario) => {
    const f = (s.filters_json ?? {}) as Partial<Intent> & { geo_level?: GeoLevel };
    const view: View = (f.view as View) ?? (s.track === 'facility_trust_desk' ? 'trust_desk' : 'desert');
    const intent: Intent = {
      view,
      capability: (f.capability as string) ?? s.capability ?? 'icu',
      geo_level: (f.geo_level ?? (s.geo_level as GeoLevel) ?? null),
      geo_value: (f.geo_value as string) ?? s.geo_value ?? null,
    };
    setActiveTab(view);
    setTurns([
      { id: uid(), role: 'user', text: s.name },
      { id: uid(), role: 'assistant', kind: 'result', intent, saved: true },
    ]);
    setSidebarOpen(false);
  }, []);

  const deleteScenario = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/api/scenarios', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (resp.ok) setScenarios(prev => prev.filter(s => Number(s.id) !== id));
    } catch {
      /* ignore */
    }
  }, []);

  const tabScenarios = scenarios.filter(s => {
    const t = s.track ?? (((s.filters_json as { view?: string } | null)?.view === 'trust_desk') ? 'facility_trust_desk' : 'medical_desert_planner');
    return t === tab.track;
  });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static z-30 top-0 bottom-0 left-0 w-72 max-w-[85vw] shrink-0 border-r border-slate-200/70 bg-white/80 backdrop-blur-xl flex flex-col transition-transform`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center gap-2.5">
          <AiMark size={18} />
          <div className="leading-tight">
            <div className="font-bold text-slate-900 tracking-tight">VetoMeds</div>
            <div className="text-[11px] text-slate-500">AI medical intelligence</div>
          </div>
        </div>

        {/* Tab switcher (replaces the New-query button) */}
        <div className="p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-bold leading-tight transition-all ${activeTab === t.id ? 'bg-sky-600 text-white shadow-md shadow-sky-600/25' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                <TabIcon id={t.id} /> {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setTurns([]); setInput(''); setSidebarOpen(false); }}
            className="mt-2 w-full text-center text-xs text-slate-400 hover:text-sky-600 transition-colors py-1"
          >
            + New query
          </button>
        </div>

        <div className="px-4 pt-1 pb-2">
          <span className="section-title">Saved · {tab.label}</span>
        </div>
        <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-4 space-y-2">
          {!scenariosLoaded && [0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl shimmer" />)}
          {scenariosLoaded && tabScenarios.length === 0 && <p className="px-1 text-xs text-slate-400">No saved {tab.label.toLowerCase()} scenarios yet.</p>}
          {scenariosLoaded && tabScenarios.map(s => (
            <button
              key={s.id}
              onClick={() => openScenario(s)}
              className="group w-full text-left rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm hover:border-sky-300 hover:bg-sky-50/40 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-sky-500 ring-2 ring-sky-100 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{s.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => deleteScenario(Number(s.id), e)}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-opacity shrink-0 p-1.5 -m-1.5"
                      aria-label="Delete scenario"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </span>
                  </div>
                  {s.capability && <span className="text-[11px] text-slate-500">{CAP_LABELS[s.capability] ?? s.capability}{s.geo_value ? ` · ${s.geo_value}` : ''}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 z-20 bg-slate-900/20 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile-only sidebar toggle (desktop keeps the sidebar always visible, no top header). */}
        <div className="md:hidden shrink-0 px-3 py-2 border-b border-slate-100">
          <button
            onClick={() => setSidebarOpen(true)}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Open scenarios"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto nice-scroll">
          {turns.length === 0 ? (
            <div className="max-w-2xl mx-auto px-4 pt-16 sm:pt-24 text-center animate-fade-up">
              <div className="flex justify-center mb-5"><AiMark size={30} /></div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-1.5">Ask VetoMeds</h1>
              <div className="flex justify-center mb-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-sky-600 text-white px-4 py-2 text-sm font-bold shadow-md shadow-sky-600/20">
                  <TabIcon id={activeTab} size={16} />{tab.heading}
                </span>
              </div>
              <p className="text-slate-500 mb-8">{tab.sub}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                {tab.suggestions.map(s => (
                  <button key={s} onClick={() => submitQuery(s)} className="card card-interactive px-4 py-3 text-sm text-slate-700 hover:text-sky-700 flex items-center gap-2.5">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 shrink-0" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
              {turns.map(t => <TurnView key={t.id} turn={t} onSave={saveScenario} saving={savingId === t.id} />)}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-slate-200/70 bg-white/85 backdrop-blur-xl">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-3">
            {turns.length > 0 && (
              <div className="flex gap-2 mb-2 overflow-x-auto nice-scroll pb-1">
                {tab.suggestions.slice(0, 3).map(s => (
                  <button key={s} onClick={() => submitQuery(s)} className="chip chip-sky whitespace-nowrap hover:bg-sky-100 transition-colors">{s}</button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitQuery(input); } }}
                placeholder={activeTab === 'desert' ? 'e.g. ICU coverage gaps in Bihar' : 'e.g. which hospitals do oncology in Delhi'}
                rows={1}
                className="field flex-1 resize-none max-h-32 py-2.5"
              />
              <button
                onClick={() => void submitQuery(input)}
                disabled={busy || !input.trim()}
                className="shrink-0 h-11 w-11 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white flex items-center justify-center transition-colors"
                aria-label="Send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 text-center">VetoMeds runs your question against 10,000 facilities — every result is evidence-cited, never a guess.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnView({ turn, onSave, saving }: { turn: Turn; onSave: (id: string, intent: Intent) => void; saving?: boolean }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="rounded-2xl rounded-br-md bg-sky-600 text-white px-4 py-2.5 max-w-[85%] text-sm leading-relaxed shadow-sm">{turn.text}</div>
      </div>
    );
  }

  if (turn.kind === 'thinking') {
    return (
      <div className="flex items-start gap-2 sm:gap-3 animate-fade-up">
        <AiMark size={16} className="hidden sm:inline-flex" />
        <div className="card px-4 py-3 flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <span key={i} className="h-2 w-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  if (turn.kind === 'clarify') {
    return (
      <div className="flex items-start gap-2 sm:gap-3 animate-fade-up">
        <AiMark size={16} className="hidden sm:inline-flex" />
        <div className="card px-4 py-3 text-sm text-slate-600 max-w-[85%]">{turn.text}</div>
      </div>
    );
  }

  const { intent } = turn;
  const capLabel = CAP_LABELS[intent.capability] ?? intent.capability;
  return (
    <div className="flex items-start gap-2 sm:gap-3 animate-fade-up">
      <AiMark size={16} className="hidden sm:inline-flex" />
      <div className="card p-4 sm:p-5 flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{capLabel}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-600 text-sm">{geoLabel(intent)}</span>
            <span className={`chip ${intent.view === 'desert' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
              {intent.view === 'desert' ? 'Coverage map' : 'Facility trust'}
            </span>
          </div>
          <button
            onClick={() => onSave(turn.id, intent)}
            disabled={turn.saved || saving}
            className={`btn-secondary text-xs px-2.5 py-1.5 gap-1.5 ${turn.saved ? 'text-teal-700 border-teal-200 bg-teal-50' : ''}`}
          >
            {turn.saved ? (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> Saved</>
            ) : saving ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="animate-spin" aria-hidden><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                Saving…
              </>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg> Save scenario</>
            )}
          </button>
        </div>

        {intent.view === 'desert' ? (
          <DesertResult
            capability={intent.capability}
            geoLevel={(intent.geo_level ?? '') as '' | 'state' | 'district' | 'pincode'}
            geoValue={intent.geo_value ?? ''}
          />
        ) : (
          <TrustDeskResult
            capability={intent.capability}
            state={intent.geo_level === 'state' ? intent.geo_value ?? undefined : undefined}
            city={intent.geo_level === 'district' ? intent.geo_value ?? undefined : undefined}
            pincode={intent.geo_level === 'pincode' ? intent.geo_value ?? undefined : undefined}
          />
        )}
      </div>
    </div>
  );
}
