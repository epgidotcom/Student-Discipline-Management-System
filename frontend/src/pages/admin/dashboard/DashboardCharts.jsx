import { Bar, Line } from 'react-chartjs-2';
import 'chart.js/auto';

import { SectionCard } from '../../../components/common/SectionCard.jsx';

export function DashboardCharts({
  trendChartData,
  topTypesChartData,
  byGradeChartData,
  hasTrendData,
  hasTopTypesData,
  hasByGradeData
}) {
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-3">
        <SectionCard
          title="Violations Over Time"
          description="Weekly trend for the selected filters."
          className="mb-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
        >
          <div className="h-60">
            {hasTrendData ? (
              <Line
                data={trendChartData}
                options={{ maintainAspectRatio: false, plugins: { legend: { display: false } } }}
              />
            ) : (
              <p className="text-sm text-slate-500">No trend data for the selected filters.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Top Violation Types"
          description="Most frequent categories for the selected range."
          className="mb-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
        >
          <div className="h-60">
            {hasTopTypesData ? (
              <Bar
                data={topTypesChartData}
                options={{
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true } }
                }}
              />
            ) : (
              <p className="text-sm text-slate-500">No category data for the selected filters.</p>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Violations by Grade"
          description="Grade distribution under the current filter set."
          className="mb-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
        >
          <div className="h-60">
          {hasByGradeData ? (
            <Bar
              data={byGradeChartData}
              options={{
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">No grade distribution data for the selected filters.</p>
          )}
        </div>
        </SectionCard>
      </div>
    </>
  );
}
