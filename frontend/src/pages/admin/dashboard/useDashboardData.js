import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../../../services/api.js';

const DEFAULT_WINDOW_DAYS = 90;
const CHART_BLUE = {
  line: '#3B82F6',
  fill: 'rgba(59, 130, 246, 0.22)',
  bar: 'rgba(59, 130, 246, 0.72)',
  border: '#60A5FA'
};

function toInputDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateInput(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function buildQuery(query) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function fetchAllPages(path, { limit = 200, query = {} } = {}) {
  const firstPage = await apiRequest(`${path}${buildQuery({ ...query, page: 1, limit })}`);

  const rows = Array.isArray(firstPage?.data)
    ? [...firstPage.data]
    : Array.isArray(firstPage)
      ? [...firstPage]
      : [];

  const totalPages = Number(firstPage?.totalPages || 1);
  if (totalPages <= 1) {
    return rows;
  }

  const tasks = [];
  for (let page = 2; page <= totalPages; page += 1) {
    tasks.push(apiRequest(`${path}${buildQuery({ ...query, page, limit })}`));
  }

  const pages = await Promise.all(tasks);
  pages.forEach((payload) => {
    if (Array.isArray(payload?.data)) {
      rows.push(...payload.data);
    }
  });

  return rows;
}

function weekBuckets(from, to) {
  const buckets = [];
  let current = new Date(from);
  while (current <= to) {
    const start = new Date(current);
    const end = addDays(start, 6);
    buckets.push({ start, end: end > to ? new Date(to) : end });
    current = addDays(end, 1);
  }
  return buckets;
}

function normalizeSectionName(value) {
  return String(value || '').trim();
}

export function useDashboardData() {
  const defaultDateRange = useMemo(() => {
    const to = new Date();
    const from = addDays(to, -89);
    return { from, to };
  }, []);

  const [overview, setOverview] = useState(null);
  const [students, setStudents] = useState([]);
  const [violations, setViolations] = useState([]);

  const [fromDate, setFromDate] = useState(toInputDate(defaultDateRange.from));
  const [toDate, setToDate] = useState(toInputDate(defaultDateRange.to));
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedViolation, setSelectedViolation] = useState('');

  const [predictiveWindow, setPredictiveWindow] = useState(DEFAULT_WINDOW_DAYS);
  const [predictiveSection, setPredictiveSection] = useState('All');
  const [predictiveStrand, setPredictiveStrand] = useState('All');
  const [predictiveViolation, setPredictiveViolation] = useState('All');
  const [predictivePayload, setPredictivePayload] = useState(null);

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingPredictive, setLoadingPredictive] = useState(false);
  const [error, setError] = useState('');
  const [predictiveError, setPredictiveError] = useState('');

  const studentById = useMemo(() => {
    const index = new Map();
    students.forEach((student) => {
      index.set(student.id, student);
    });
    return index;
  }, [students]);

  const normalizedViolations = useMemo(
    () => violations.map((violation) => {
      const student = studentById.get(violation.studentId);
      return {
        id: violation.id,
        studentId: violation.studentId,
        incidentDate: violation.incidentDate,
        offenseCategory: String(violation.offenseCategory || '').trim(),
        offenseDescription: String(violation.offenseDescription || '').trim(),
        gradeLevel: student?.gradeLevel ?? null,
        sectionName: student?.sectionName ?? '',
        statusCode: String(violation.statusCode || '').trim()
      };
    }),
    [violations, studentById]
  );

  const gradeOptions = useMemo(() => {
    const values = new Set();
    students.forEach((student) => {
      if (student.gradeLevel !== null && student.gradeLevel !== undefined && student.gradeLevel !== '') {
        values.add(String(student.gradeLevel));
      }
    });
    return Array.from(values).sort((a, b) => Number(a) - Number(b));
  }, [students]);

  const sectionOptions = useMemo(() => {
    const values = new Set();
    students.forEach((student) => {
      const grade = String(student.gradeLevel ?? '');
      if (selectedGrade && grade !== selectedGrade) {
        return;
      }
      const section = normalizeSectionName(student.sectionName);
      if (section) values.add(section);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [students, selectedGrade]);

  const violationOptions = useMemo(() => {
    const values = new Set();
    normalizedViolations.forEach((violation) => {
      if (violation.offenseCategory) {
        values.add(violation.offenseCategory);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [normalizedViolations]);

  const filteredViolations = useMemo(() => {
    const from = parseDateInput(fromDate, defaultDateRange.from);
    const to = parseDateInput(toDate, defaultDateRange.to);
    const fromMs = from.getTime();
    const toMs = addDays(to, 1).getTime() - 1;

    return normalizedViolations.filter((violation) => {
      const incident = new Date(`${String(violation.incidentDate || '').slice(0, 10)}T00:00:00`);
      if (Number.isNaN(incident.getTime())) {
        return false;
      }
      const incidentMs = incident.getTime();
      if (incidentMs < fromMs || incidentMs > toMs) {
        return false;
      }
      if (selectedGrade && String(violation.gradeLevel ?? '') !== selectedGrade) {
        return false;
      }
      if (selectedSection && normalizeSectionName(violation.sectionName) !== selectedSection) {
        return false;
      }
      if (selectedViolation && violation.offenseCategory !== selectedViolation) {
        return false;
      }
      return true;
    });
  }, [normalizedViolations, fromDate, toDate, selectedGrade, selectedSection, selectedViolation, defaultDateRange]);

  const trendChartData = useMemo(() => {
    const from = parseDateInput(fromDate, defaultDateRange.from);
    const to = parseDateInput(toDate, defaultDateRange.to);
    const buckets = weekBuckets(from, to);

    const counts = buckets.map((bucket) => {
      const min = bucket.start.getTime();
      const max = addDays(bucket.end, 1).getTime() - 1;
      return filteredViolations.filter((violation) => {
        const incident = new Date(`${String(violation.incidentDate || '').slice(0, 10)}T00:00:00`);
        if (Number.isNaN(incident.getTime())) return false;
        const value = incident.getTime();
        return value >= min && value <= max;
      }).length;
    });

    return {
      labels: buckets.map((bucket) => `${formatDisplayDate(bucket.start)} - ${formatDisplayDate(bucket.end)}`),
      datasets: [
        {
          label: 'Violations per week',
          data: counts,
          borderColor: CHART_BLUE.line,
          backgroundColor: CHART_BLUE.fill,
          pointBackgroundColor: CHART_BLUE.line,
          pointBorderColor: CHART_BLUE.line,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 3
        }
      ]
    };
  }, [filteredViolations, fromDate, toDate, defaultDateRange]);

  const topTypesChartData = useMemo(() => {
    const counts = new Map();
    filteredViolations.forEach((violation) => {
      const key = violation.offenseCategory || violation.offenseDescription || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const rows = Array.from(counts.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    return {
      labels: rows.map((row) => row.label),
      datasets: [
        {
          label: 'Count',
          data: rows.map((row) => row.total),
          backgroundColor: CHART_BLUE.bar,
          borderColor: CHART_BLUE.border,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [filteredViolations]);

  const byGradeChartData = useMemo(() => {
    const counts = new Map();
    filteredViolations.forEach((violation) => {
      if (violation.gradeLevel === null || violation.gradeLevel === undefined) return;
      const key = String(violation.gradeLevel);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const rows = Array.from(counts.entries())
      .map(([grade, total]) => ({ grade, total }))
      .sort((a, b) => Number(a.grade) - Number(b.grade));

    return {
      labels: rows.map((row) => row.grade),
      datasets: [
        {
          label: 'Violations',
          data: rows.map((row) => row.total),
          backgroundColor: CHART_BLUE.bar,
          borderColor: CHART_BLUE.border,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [filteredViolations]);

  const predictiveStrandOptions = useMemo(() => {
    const set = new Set();
    const entries = Array.isArray(predictivePayload?.section_entries) ? predictivePayload.section_entries : [];
    entries.forEach((entry) => {
      const strand = String(entry?.strand || '').trim();
      if (strand) set.add(strand);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [predictivePayload]);

  const predictiveSectionOptions = useMemo(() => {
    const sections = Array.isArray(predictivePayload?.sections) ? predictivePayload.sections : [];
    const entries = Array.isArray(predictivePayload?.section_entries) ? predictivePayload.section_entries : [];

    if (!predictiveStrand || predictiveStrand === 'All') {
      return sections;
    }

    const allowed = new Set(
      entries
        .filter((entry) => String(entry?.strand || '').trim() === predictiveStrand)
        .map((entry) => String(entry?.grade_section || '').trim())
        .filter(Boolean)
    );

    if (!allowed.size) return sections;
    return sections.filter((section) => allowed.has(section));
  }, [predictivePayload, predictiveStrand]);

  const predictiveRows = useMemo(() => {
    const rows = Array.isArray(predictivePayload?.rows) ? predictivePayload.rows : [];
    if (!predictiveStrand || predictiveStrand === 'All') {
      return rows;
    }

    const entries = Array.isArray(predictivePayload?.section_entries) ? predictivePayload.section_entries : [];
    const allowed = new Set(
      entries
        .filter((entry) => String(entry?.strand || '').trim() === predictiveStrand)
        .map((entry) => String(entry?.grade_section || '').trim())
        .filter(Boolean)
    );

    if (!allowed.size) return rows;
    return rows.filter((row) => allowed.has(String(row?.section || '').trim()));
  }, [predictivePayload, predictiveStrand]);

  const predictiveChartData = useMemo(() => ({
    labels: predictiveRows.map((row) => row.section),
    datasets: [
      {
        label: 'Repeat Violation Likelihood (%)',
        data: predictiveRows.map((row) => Math.round(Number(row.likelihood || 0) * 10000) / 100),
        backgroundColor: CHART_BLUE.bar,
        borderColor: CHART_BLUE.border,
        borderWidth: 1,
        borderRadius: 6
      }
    ]
  }), [predictiveRows]);

  const kpiCards = useMemo(() => {
    const today = new Date();
    const cutoff30 = addDays(today, -29).getTime();
    const cutoff90 = addDays(today, -89).getTime();

    let violationsLast30 = 0;
    let openCases = 0;
    const offenderCounts = new Map();

    normalizedViolations.forEach((violation) => {
      const incident = new Date(`${String(violation.incidentDate || '').slice(0, 10)}T00:00:00`);
      const incidentMs = incident.getTime();

      if (!Number.isNaN(incidentMs)) {
        if (incidentMs >= cutoff30) {
          violationsLast30 += 1;
        }

        if (incidentMs >= cutoff90 && violation.studentId) {
          offenderCounts.set(violation.studentId, (offenderCounts.get(violation.studentId) || 0) + 1);
        }
      }

      const status = String(violation.statusCode || '').toLowerCase();
      if (/(pending|open|ongoing|review|investigat)/.test(status)) {
        openCases += 1;
      }
    });

    const repeatOffenders = Array.from(offenderCounts.values()).filter((count) => count >= 3).length;
    const totalStudents = Number.isFinite(Number(overview?.students)) ? Number(overview.students) : students.length;

    return [
      {
        key: 'students',
        label: 'Students',
        value: totalStudents,
        hint: 'Registered',
        tone: 'blue'
      },
      {
        key: 'violations',
        label: 'Violations',
        value: violationsLast30,
        hint: 'Last 30 days',
        tone: 'amber'
      },
      {
        key: 'open-cases',
        label: 'Open Cases',
        value: openCases,
        hint: 'Needing follow-up',
        tone: 'cyan'
      },
      {
        key: 'repeat-offenders',
        label: 'Repeat Offenders',
        value: repeatOffenders,
        hint: '>= 3 violations (90d)',
        tone: 'rose'
      }
    ];
  }, [normalizedViolations, overview?.students, students.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadBaseData() {
      try {
        setLoadingBase(true);
        setError('');
        const [overviewData, allStudents, allViolations] = await Promise.all([
          apiRequest('/analytics/overview'),
          fetchAllPages('/students', { limit: 200 }),
          fetchAllPages('/violations', { limit: 200 })
        ]);

        if (!cancelled) {
          setOverview(overviewData);
          setStudents(Array.isArray(allStudents) ? allStudents : []);
          setViolations(Array.isArray(allViolations) ? allViolations : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load dashboard');
        }
      } finally {
        if (!cancelled) {
          setLoadingBase(false);
        }
      }
    }

    loadBaseData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshOverview() {
      try {
        const payload = await apiRequest(`/analytics/overview${buildQuery({ fromDate, toDate })}`);
        if (!cancelled) {
          setOverview(payload);
        }
      } catch {
        // Keep base dashboard usable even when this refresh fails.
      }
    }

    refreshOverview();
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadPredictive() {
      try {
        setLoadingPredictive(true);
        setPredictiveError('');

        const payload = await apiRequest(
          `/analytics/predictive-repeat-risk${buildQuery({
            section: predictiveSection,
            violation: predictiveViolation,
            window_days: predictiveWindow,
            limit: 50
          })}`
        );

        if (!cancelled) {
          setPredictivePayload(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setPredictiveError(loadError.message || 'Predictive analytics is unavailable.');
        }
      } finally {
        if (!cancelled) {
          setLoadingPredictive(false);
        }
      }
    }

    loadPredictive();
    return () => {
      cancelled = true;
    };
  }, [predictiveSection, predictiveViolation, predictiveWindow]);

  useEffect(() => {
    if (predictiveSection === 'All') {
      return;
    }

    if (!predictiveSectionOptions.includes(predictiveSection)) {
      setPredictiveSection('All');
    }
  }, [predictiveSection, predictiveSectionOptions]);

  function applyQuickRange(days) {
    const to = new Date();
    const from = addDays(to, -(days - 1));
    setFromDate(toInputDate(from));
    setToDate(toInputDate(to));
  }

  function resetFilters() {
    const to = new Date();
    const from = addDays(to, -89);
    setFromDate(toInputDate(from));
    setToDate(toInputDate(to));
    setSelectedGrade('');
    setSelectedSection('');
    setSelectedViolation('');
  }

  const hasTrendData = trendChartData.datasets[0]?.data?.some((value) => value > 0);
  const hasTopTypesData = topTypesChartData.datasets[0]?.data?.some((value) => value > 0);
  const hasByGradeData = byGradeChartData.datasets[0]?.data?.some((value) => value > 0);
  const hasPredictiveData = predictiveChartData.datasets[0]?.data?.length > 0;

  return {
    overview,
    error,
    loadingBase,
    predictiveError,
    loadingPredictive,
    fromDate,
    toDate,
    selectedGrade,
    selectedSection,
    selectedViolation,
    predictiveWindow,
    predictiveSection,
    predictiveStrand,
    predictiveViolation,
    predictivePayload,
    gradeOptions,
    sectionOptions,
    violationOptions,
    predictiveStrandOptions,
    predictiveSectionOptions,
    predictiveRows,
    trendChartData,
    topTypesChartData,
    byGradeChartData,
    predictiveChartData,
    kpiCards,
    hasTrendData,
    hasTopTypesData,
    hasByGradeData,
    hasPredictiveData,
    rangeLabel: `${formatDisplayDate(parseDateInput(fromDate, defaultDateRange.from))} - ${formatDisplayDate(parseDateInput(toDate, defaultDateRange.to))}`,
    setFromDate,
    setToDate,
    setSelectedGrade,
    setSelectedSection,
    setSelectedViolation,
    setPredictiveWindow,
    setPredictiveSection,
    setPredictiveStrand,
    setPredictiveViolation,
    applyQuickRange,
    resetFilters
  };
}
