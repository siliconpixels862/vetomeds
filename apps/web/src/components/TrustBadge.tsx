type Tier = 'high' | 'medium' | 'low' | 'unknown';

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tier(score: number | null): Tier {
  if (score == null) return 'unknown';
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

const styles: Record<Tier, { bg: string; text: string; dot: string; label: string }> = {
  high:    { bg: 'bg-emerald-50', text: 'text-emerald-800', dot: 'bg-emerald-500', label: 'High trust' },
  medium:  { bg: 'bg-amber-50',   text: 'text-amber-800',   dot: 'bg-amber-500',   label: 'Medium trust' },
  low:     { bg: 'bg-rose-50',    text: 'text-rose-800',    dot: 'bg-rose-500',    label: 'Low trust' },
  unknown: { bg: 'bg-slate-100',  text: 'text-slate-700',   dot: 'bg-slate-400',   label: 'Trust n/a' },
};

export function TrustBadge({ score, showScore = true }: { score: number | string | null | undefined; showScore?: boolean }) {
  const n = toNum(score);
  const t = tier(n);
  const s = styles[t];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text} ring-1 ring-inset ring-current/10`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span>{s.label}</span>
      {showScore && n != null && <span className="opacity-70 tabular-nums">· {n.toFixed(2)}</span>}
    </span>
  );
}
