interface Citation {
  capability: string;
  sentence: string;
}

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
  obstetrics_gynecology: 'OB-GYN',
  neonatal_nicu: 'NICU',
  ct_scan: 'CT scan',
  mri: 'MRI',
  ultrasound: 'Ultrasound',
  pathology_lab: 'Pathology lab',
  ventilator: 'Ventilator',
  oxygen_supply: 'Oxygen supply',
};

export function EvidenceCitation({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) {
    return <p className="text-xs italic text-slate-500">No supporting sentences found.</p>;
  }
  return (
    <ul className="space-y-3">
      {citations.slice(0, 6).map((c, i) => (
        <li key={i} className="rounded-xl border-l-2 border-sky-300 bg-sky-50/40 rounded-l-none pl-3.5 pr-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              {CAP_LABELS[c.capability] ?? c.capability}
            </span>
          </div>
          <p className="text-sm italic text-slate-600 leading-relaxed">&ldquo;{c.sentence}&rdquo;</p>
        </li>
      ))}
    </ul>
  );
}
