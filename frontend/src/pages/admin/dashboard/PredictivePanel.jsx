import { Bar } from 'react-chartjs-2';
import 'chart.js/auto';

import { ErrorBanner } from '../../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../../components/common/SectionCard.jsx';

export function PredictivePanel({
  predictiveError,
  loadingPredictive,
  predictiveWindow,
  predictiveSection,
  predictiveStrand,
  predictiveViolation,
  predictivePayload,
  predictiveRows,
  predictiveStrandOptions,
  predictiveSectionOptions,
  predictiveChartData,
  hasPredictiveData,
  setPredictiveWindow,
  setPredictiveSection,
  setPredictiveStrand,
  setPredictiveViolation
}) {
  return (
    <>
      <ErrorBanner message={predictiveError} />
      <SectionCard
        title="Predictive Analytics - Repeat Violation Likelihood by Section"
        description="Live section-level risk from /api/analytics/predictive-repeat-risk"
        className="mb-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Window</span>
            <select
              value={String(predictiveWindow)}
              onChange={(event) => setPredictiveWindow(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">3 months</option>
              <option value="365">1 year</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Grade-Section</span>
            <select
              value={predictiveSection}
              onChange={(event) => setPredictiveSection(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="All">All</option>
              {predictiveSectionOptions.map((section) => (
                <option key={section} value={section}>{section}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Strand</span>
            <select
              value={predictiveStrand}
              onChange={(event) => setPredictiveStrand(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="All">All</option>
              {predictiveStrandOptions.map((strand) => (
                <option key={strand} value={strand}>{strand}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Violation Type</span>
            <select
              value={predictiveViolation}
              onChange={(event) => setPredictiveViolation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="All">All</option>
              {(predictivePayload?.violations || []).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 h-64">
          {loadingPredictive ? (
            <p className="text-sm text-slate-500">Loading predictive analytics...</p>
          ) : hasPredictiveData ? (
            <Bar
              data={predictiveChartData}
              options={{
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, max: 100 } },
                plugins: {
                  tooltip: {
                    callbacks: {
                      label(context) {
                        const sampleSize = predictiveRows[context.dataIndex]?.sample_size || 0;
                        return `${context.formattedValue}% likelihood (n=${sampleSize})`;
                      }
                    }
                  }
                }
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">No predictive data available for the current filters.</p>
          )}
        </div>

        {predictivePayload?.generated_at ? (
          <p className="mt-1 text-xs text-slate-500">Last updated: {new Date(predictivePayload.generated_at).toLocaleString()}</p>
        ) : null}
      </SectionCard>
    </>
  );
}
