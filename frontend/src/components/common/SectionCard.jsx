export function SectionCard({ title, description, children, className = '' }) {
  return (
    <section className={`section-card mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <h2 className="section-card-title font-display text-2xl leading-tight text-slate-900">{title}</h2>
          {description ? <p className="section-card-description text-sm text-slate-600">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
