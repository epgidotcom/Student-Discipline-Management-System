function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 19v-1a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v1" />
      <circle cx="9.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19v-1a3 3 0 0 0-2-2.83" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 5.2a3 3 0 0 1 0 5.6" />
    </svg>
  );
}

function IconViolation() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 2.7 19.2a1 1 0 0 0 .9 1.5h16.8a1 1 0 0 0 .9-1.5Z" />
      <path strokeLinecap="round" d="M12 9v4.5" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconOpenCase() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="6" y="4.5" width="12" height="16" rx="2.2" />
      <path strokeLinecap="round" d="M9.5 3.5h5" />
      <path strokeLinecap="round" d="M9 10h6M9 13h6M9 16h4" />
    </svg>
  );
}

function IconRepeat() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="8.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 18.5a5 5 0 0 1 10 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m15.5 8.5 2.2-2.2m0 0v1.9m0-1.9h-1.9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20.5 15.5-2.2 2.2m0 0v-1.9m0 1.9h1.9" />
    </svg>
  );
}

const toneMap = {
  blue: {
    accent: 'before:bg-blue-700',
    iconWrap: 'border-blue-200 bg-blue-50 text-blue-900'
  },
  amber: {
    accent: 'before:bg-amber-600',
    iconWrap: 'border-amber-200 bg-amber-50 text-amber-800'
  },
  cyan: {
    accent: 'before:bg-cyan-700',
    iconWrap: 'border-cyan-200 bg-cyan-50 text-cyan-800'
  },
  rose: {
    accent: 'before:bg-rose-700',
    iconWrap: 'border-rose-200 bg-rose-50 text-rose-800'
  }
};

const iconByKey = {
  students: IconUsers,
  violations: IconViolation,
  'open-cases': IconOpenCase,
  'repeat-offenders': IconRepeat
};

export function DashboardKpiGrid({ cards }) {
  const items = Array.isArray(cards) ? cards : [];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const tone = toneMap[item.tone] || toneMap.blue;
        const Icon = iconByKey[item.key] || IconUsers;

        return (
        <article
          key={item.key}
          className={`kpi-card kpi-tone-${item.tone} relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all duration-200 ease-out before:absolute before:inset-y-0 before:left-0 before:w-1 hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg ${tone.accent}`}
        >
          <div className="flex items-center gap-3">
            <div className={`kpi-icon-wrap grid h-16 w-16 place-items-center rounded-2xl border ${tone.iconWrap}`}>
              <Icon />
            </div>
            <div>
              <p className="kpi-label text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <p className="kpi-value mt-1 text-[2.05rem] font-display leading-none text-slate-900">{Number(item.value ?? 0).toLocaleString()}</p>
              <p className="kpi-hint mt-1 text-sm font-medium text-slate-600">{item.hint}</p>
            </div>
          </div>
        </article>
        );
      })}
    </div>
  );
}
