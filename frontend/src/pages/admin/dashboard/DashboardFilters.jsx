import { SectionCard } from '../../../components/common/SectionCard.jsx';

export function DashboardFilters({
  fromDate,
  toDate,
  selectedGrade,
  selectedSection,
  selectedViolation,
  gradeOptions,
  sectionOptions,
  violationOptions,
  rangeLabel,
  setFromDate,
  setToDate,
  setSelectedGrade,
  setSelectedSection,
  setSelectedViolation,
  applyQuickRange,
  resetFilters
}) {
  return (
    <SectionCard
      title="Dashboard Filters"
      description="Refine charts by date, grade, section, and violation category."
      className="mb-3 transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
          />
        </label>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
          />
        </label>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Grade</span>
          <select
            value={selectedGrade}
            onChange={(event) => {
              setSelectedGrade(event.target.value);
              setSelectedSection('');
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
          >
            <option value="">All</option>
            {gradeOptions.map((grade) => (
              <option key={grade} value={grade}>{grade}</option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Section</span>
          <select
            value={selectedSection}
            onChange={(event) => setSelectedSection(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
          >
            <option value="">All</option>
            {sectionOptions.map((section) => (
              <option key={section} value={section}>{section}</option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Violation</span>
          <select
            value={selectedViolation}
            onChange={(event) => setSelectedViolation(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
          >
            <option value="">All</option>
            {violationOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-end gap-2 xl:justify-end">
          <button
            type="button"
            onClick={() => applyQuickRange(7)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Last 7d
          </button>
          <button
            type="button"
            onClick={() => applyQuickRange(30)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Last 30d
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-2 text-right text-sm text-slate-600">Range: {rangeLabel}</div>
    </SectionCard>
  );
}
