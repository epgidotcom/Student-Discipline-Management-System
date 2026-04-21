import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import {
  DashboardCharts,
  DashboardFilters,
  DashboardKpiGrid,
  PredictivePanel,
  useDashboardData
} from './dashboard/index.js';

export function DashboardPage() {
  const data = useDashboardData();

  return (
    <>
      <ErrorBanner message={data.error} />
      {data.loadingBase ? (
        <SectionCard
          title="Loading dashboard"
          description="Fetching students, violations, and analytics."
          className="transition-all duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
        >
          <p className="text-sm text-slate-600">Please wait...</p>
        </SectionCard>
      ) : null}

      <DashboardKpiGrid cards={data.kpiCards} />

      <div className="mt-5">
        <DashboardFilters
          fromDate={data.fromDate}
          toDate={data.toDate}
          selectedGrade={data.selectedGrade}
          selectedSection={data.selectedSection}
          selectedViolation={data.selectedViolation}
          gradeOptions={data.gradeOptions}
          sectionOptions={data.sectionOptions}
          violationOptions={data.violationOptions}
          rangeLabel={data.rangeLabel}
          setFromDate={data.setFromDate}
          setToDate={data.setToDate}
          setSelectedGrade={data.setSelectedGrade}
          setSelectedSection={data.setSelectedSection}
          setSelectedViolation={data.setSelectedViolation}
          applyQuickRange={data.applyQuickRange}
          resetFilters={data.resetFilters}
        />
      </div>

      <DashboardCharts
        trendChartData={data.trendChartData}
        topTypesChartData={data.topTypesChartData}
        byGradeChartData={data.byGradeChartData}
        hasTrendData={data.hasTrendData}
        hasTopTypesData={data.hasTopTypesData}
        hasByGradeData={data.hasByGradeData}
      />

      <PredictivePanel
        predictiveError={data.predictiveError}
        loadingPredictive={data.loadingPredictive}
        predictiveWindow={data.predictiveWindow}
        predictiveSection={data.predictiveSection}
        predictiveStrand={data.predictiveStrand}
        predictiveViolation={data.predictiveViolation}
        predictivePayload={data.predictivePayload}
        predictiveRows={data.predictiveRows}
        predictiveStrandOptions={data.predictiveStrandOptions}
        predictiveSectionOptions={data.predictiveSectionOptions}
        predictiveChartData={data.predictiveChartData}
        hasPredictiveData={data.hasPredictiveData}
        setPredictiveWindow={data.setPredictiveWindow}
        setPredictiveSection={data.setPredictiveSection}
        setPredictiveStrand={data.setPredictiveStrand}
        setPredictiveViolation={data.setPredictiveViolation}
      />
    </>
  );
}
