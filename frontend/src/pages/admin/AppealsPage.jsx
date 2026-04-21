import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { apiRequest } from '../../services/api.js';
import { formatDate } from '../../utils/formatDate.js';

function badgeClass(code) {
  const c = String(code ?? '').trim().toLowerCase();
  if (c === 'approved' || c === 'resolved') return 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (c === 'appealed') return 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200';
  if (c === 'pending') return 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200';
  if (c === 'rejected' || c === 'dismissed') return 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200';
  return 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200';
}

function formatCaseNumber(id) {
  if (!id) return '—';
  const s = String(id);
  // If it's a UUID, use the first segment; otherwise use a short prefix
  if (s.indexOf('-') !== -1) return s.split('-')[0];
  return s.slice(0, 8);
}

export function AppealsPage() {
  const [appeals, setAppeals] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadAppeals = async () => {
    setLoading(true);
    try {
      // Honor optional ?violationId=<id> query parameter so Violations detail can link here
      const rawQuery = window.location.search || (window.location.hash && window.location.hash.includes('?') ? `?${window.location.hash.split('?')[1]}` : '');
      const params = new URLSearchParams(rawQuery);
      const violationId = params.get('violationId');
      const path = violationId ? `/appeals?violationId=${encodeURIComponent(violationId)}` : '/appeals';
      const payload = await apiRequest(path);
      setAppeals(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load appeals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppeals();
  }, []);

  const filtered = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return appeals;
    return appeals.filter((a) => {
      const studentName = (a?.student?.name || a?.student?.fullName || '').toLowerCase();
      const lrn = String(a?.student?.lrn || a?.student?.studentId || '').toLowerCase();
      const reason = String(a?.appealText || '').toLowerCase();
      const violation = String(a?.violationId || a?.violationId || '').toLowerCase();
      const offense = String(a?.offense?.description || a?.offenseDescription || '').toLowerCase();
      return studentName.includes(q) || lrn.includes(q) || reason.includes(q) || violation.includes(q) || offense.includes(q);
    });
  }, [appeals, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const startIndex = (page - 1) * pageSize;

  const onDelete = async (appealId) => {
    if (!window.confirm('Delete this appeal? This action cannot be undone.')) return;
    setError('');
    setSuccess('');
    setDeletingId(appealId);
    try {
      await apiRequest(`/appeals/${appealId}`, { method: 'DELETE' });
      setAppeals((prev) => prev.filter((p) => p.id !== appealId));
      setSuccess('Appeal deleted.');
    } catch (err) {
      setError(err.message || 'Failed to delete appeal');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <SectionCard title="Appeals" description="Guidance/Admin review view with normalized status fields.">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by student, LRN, violation, or reason"
              className="w-full sm:w-[420px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
            />
            <button type="button" onClick={() => { setSearch(''); setPage(1); }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">Clear</button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={loadAppeals} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">Refresh</button>
            <div className="text-sm text-slate-500">{loading ? 'Loading…' : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}</div>
          </div>
        </div>

        <div className="grid gap-3">
          {visible.map((a, idx) => (
            <article key={a.id} className="appeal-card flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Case <span className="font-mono text-xs text-slate-600">{startIndex + idx + 1}</span> • <span className="text-slate-600">{formatDate(a.createdAt)}</span></div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{a.student?.name || a.student?.fullName || 'Unknown Student'}</div>
                  </div>
                  </div>

                <div className="mt-2 text-sm text-slate-700">{a.appealText || '—'}</div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <div className="text-slate-500">LRN: <span className="text-slate-700">{a.student?.lrn || a.student?.studentId || '—'}</span></div>
                  <div className="text-slate-500">Offense: <span className="text-slate-700">{a.offense?.description || a.offenseDescription || '—'}</span></div>
                </div>
              </div>

              <div className="mt-2 flex shrink-0 flex-col items-end gap-3 sm:mt-0 sm:ml-4 sm:w-44">
                <div className="w-full text-right">
                  <span className={badgeClass(a.status?.label || a.status?.code || a.status?.label)}>{a.status?.label || a.status?.code || 'Pending'}</span>
                </div>

                <div className="flex w-full items-center justify-end gap-2">
                  <button type="button" onClick={() => navigator.clipboard?.writeText(a.violationId || '')} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm">Copy ID</button>
                  <button type="button" onClick={() => onDelete(a.id)} disabled={deletingId === a.id} className="rounded-md bg-rose-500 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60">{deletingId === a.id ? 'Deleting…' : 'Delete'}</button>
                </div>
              </div>
            </article>
          ))}

          {!filtered.length && !loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No appeals found.</div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">Page {page} of {pageCount}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm">Prev</button>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm">Next</button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Submit Appeal" description="Admin/Guidance can create appeals here.">
        <SubmitForm
          onCreated={(created) => {
            try {
              if (created && created.id) {
                // insert the newly created appeal at the top of the current list so it's visible immediately
                setAppeals((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
              } else {
                loadAppeals();
              }
              setSuccess('Appeal submitted.');
            } catch (e) {
              // fallback: reload the list
              loadAppeals();
            }
          }}
          setError={setError}
        />
      </SectionCard>
    </>
  );
}

function SubmitForm({ onCreated, setError }) {
  const [form, setForm] = useState({ violationId: '', appealText: '', lrn: '', studentName: '', section: '', offenseDescription: '', existingAppealId: null });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Live-search / autofill state
  const [suggestions, setSuggestions] = useState([]);
  const [suggLoading, setSuggLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimer = useRef(null);
  const suggestionSequenceRef = useRef(0);
  const SEARCH_DEBOUNCE_MS = 300;
  const [searchQuery, setSearchQuery] = useState('');

  const lrnRegex = /^[A-Za-z0-9]{6,20}$/;
  // Detect probable LRN (numeric IDs up to 12 digits) for fast-path lookup
  const numericLrnDetect = /^\d{1,12}$/;

  const fetchSuggestions = async (q) => {
    const query = String(q || '').trim();
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const sequence = suggestionSequenceRef.current + 1;
    suggestionSequenceRef.current = sequence;

    setSuggLoading(true);
    try {
      // Fast-path: if query looks like an LRN (numeric short id), find student(s) first
      if (numericLrnDetect.test(query)) {
        const studentsPayload = await apiRequest(`/students?q=${encodeURIComponent(query)}&page=1&limit=8&active=true`);
        if (sequence !== suggestionSequenceRef.current) return;

        const students = Array.isArray(studentsPayload?.data) ? studentsPayload.data : [];

        if (!students.length) {
          setSuggestions([]);
          setShowSuggestions(false);
          return;
        }

        // If exactly one student, fetch their recent violations and any existing appeals
        if (students.length === 1) {
          const student = students[0];
          const vPayload = await apiRequest(`/violations?studentId=${encodeURIComponent(student.id)}&page=1&limit=8&active=true`);
          if (sequence !== suggestionSequenceRef.current) return;

          const violations = Array.isArray(vPayload?.data) ? vPayload.data : [];

          // Also fetch appeals for this student so we can surface existing appeals in suggestions
          let appealsForStudent = [];
          try {
            const aPayload = await apiRequest(`/appeals?studentId=${encodeURIComponent(student.id)}`);
            if (sequence !== suggestionSequenceRef.current) return;
            appealsForStudent = Array.isArray(aPayload) ? aPayload : [];
          } catch (ae) {
            appealsForStudent = [];
          }

          if (appealsForStudent.length || violations.length) {
            const appealSuggestions = appealsForStudent.map((ap) => ({
              appealOnly: true,
              id: `appeal:${ap.id}`,
              appealId: ap.id,
              violationId: ap.violationId,
              appealText: ap.appealText,
              student: ap.student,
              offense: ap.offense,
              createdAt: ap.createdAt
            }));

            const violationsWithAppealFlag = violations.map((v) => {
              const linked = appealsForStudent.find((ap) => ap.violationId === v.id);
              return {
                ...v,
                existingAppeal: !!linked,
                linkedAppeal: linked || null
              };
            });

            setSuggestions([...appealSuggestions, ...violationsWithAppealFlag]);
            setShowSuggestions(true);
            return;
          }

          // No violations or appeals: show a single student-only suggestion so user can fill student details
          setSuggestions([{
            studentOnly: true,
            student: {
              name: student.fullName || `${student.firstName || ''} ${student.lastName || ''}`.trim(),
              studentId: student.studentId || student.lrn || ''
            },
            id: `student:${student.id}`
          }]);
          setShowSuggestions(true);
          return;
        }

        // Multiple students: show student options to disambiguate
        const studentOptions = students.map((st) => ({
          studentOnly: true,
          student: { name: st.fullName || `${st.firstName || ''} ${st.lastName || ''}`.trim(), studentId: st.lrn || st.studentId || '' },
          id: `student:${st.id}`
        }));
        setSuggestions(studentOptions);
        setShowSuggestions(true);
        return;
      }

      // Default path: query violations by name/offense/notes (backend q doesn't include LRN)
      const res = await apiRequest(`/violations?q=${encodeURIComponent(query)}&page=1&limit=8&active=true`);
      if (sequence !== suggestionSequenceRef.current) return;

      const list = Array.isArray(res?.data) ? res.data : [];
      setSuggestions(list);
      setShowSuggestions(true);
    } catch (e) {
      if (suggestionSequenceRef.current === sequence) {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } finally {
      if (suggestionSequenceRef.current === sequence) setSuggLoading(false);
    }
  };

  const triggerSearch = (q) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(q), SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      suggestionSequenceRef.current += 1; // invalidate any in-flight suggestions
    };
  }, []);

  const validate = () => {
    const errors = {};
    if (!String(form.violationId || '').trim()) errors.violationId = 'Violation ID is required';
    if (!String(form.studentName || '').trim()) errors.studentName = 'Student name is required';
    if (!String(form.lrn || '').trim()) errors.lrn = 'LRN is required';
    else if (!lrnRegex.test(String(form.lrn).trim())) errors.lrn = 'LRN must be 6–20 alphanumeric characters';
    if (!String(form.appealText || '').trim()) errors.appealText = 'Appeal reason is required';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      // send all fields; backend may ignore unknown fields
      const created = await apiRequest('/appeals', { method: 'POST', body: form });
      setForm({ violationId: '', appealText: '', lrn: '', studentName: '', section: '', offenseDescription: '', existingAppealId: null });
      setFieldErrors({});
      if (typeof onCreated === 'function') onCreated(created);
    } catch (err) {
      setError(err.message || 'Failed to submit appeal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuggestionClick = async (s) => {
    // If this is a student-only option, try to fetch their violations first
    if (s?.studentOnly) {
      const sid = String(s.id || '').startsWith('student:') ? String(s.id).split(':', 2)[1] : null;
      if (!sid) {
        setForm((p) => ({ ...p, violationId: '', studentName: s.student?.name || p.studentName, lrn: s.student?.lrn || s.student?.studentId || p.lrn, offenseDescription: '', existingAppealId: null }));
        setFieldErrors({});
        setSearchQuery(s.student?.name || s.student?.lrn || s.student?.studentId || '');
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setSuggLoading(true);
      try {
        const vPayload = await apiRequest(`/violations?studentId=${encodeURIComponent(sid)}&page=1&limit=8&active=true`);
        const violations = Array.isArray(vPayload?.data) ? vPayload.data : [];
        if (violations.length) {
          setSuggestions(violations);
          setShowSuggestions(true);
          return;
        }

        // No violations: select student details
        setForm((p) => ({ ...p, violationId: '', studentName: s.student?.name || p.studentName, lrn: s.student?.lrn || s.student?.studentId || p.lrn, offenseDescription: '', existingAppealId: null }));
        setFieldErrors({});
        setSearchQuery(s.student?.name || s.student?.lrn || s.student?.studentId || '');
        setSuggestions([]);
        setShowSuggestions(false);
      } catch (e) {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setSuggLoading(false);
      }

      return;
    }

    // If this is an existing appeal suggestion, populate the form with its data
    if (s?.appealOnly) {
      setForm((p) => ({
        ...p,
        violationId: s.violationId || '',
        studentName: s.student?.name || p.studentName,
        lrn: s.student?.lrn || s.student?.studentId || p.lrn,
        section: s.student?.sectionName || p.section,
        offenseDescription: s.offense?.description || p.offenseDescription || '',
        appealText: s.appealText || p.appealText || '',
        existingAppealId: s.appealId || null
      }));
      setFieldErrors({});
      setSearchQuery(s.student?.name || s.student?.lrn || s.student?.studentId || '');
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Otherwise it's a violation suggestion — select it
    setForm((p) => ({
      ...p,
      violationId: s.id || s.violationId || '',
      studentName: s.student?.name || s.studentName || p.studentName,
      lrn: s.studentLrn || s.student?.lrn || s.student?.studentId || p.lrn,
      section: s.sectionName || s.gradeSection || s.section_name || s.grade_section || s.student?.section || p.section,
      offenseDescription: s.offense?.description || s.offenseDescription || '',
      existingAppealId: s.linkedAppeal?.id || null
    }));
    setFieldErrors({});
    setSearchQuery(s.student?.name || s.studentName || s.student?.lrn || s.student?.studentId || '');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div>
        <label className="text-xs">
          <div className="mb-1 font-medium">Search (LRN or Student name)</div>
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); triggerSearch(e.target.value); }}
            onFocus={() => { if (searchQuery) triggerSearch(searchQuery); }}
            placeholder="Type LRN or student name to find a violation"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {showSuggestions && suggestions && suggestions.length ? (
          <div className="mt-2 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
            {suggLoading ? <div className="p-2 text-center text-slate-500">Searching…</div> : null}
            {suggestions.map((s, idx) => (
              <button
                key={s.id || s.violationId}
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => { handleSuggestionClick(s); }}
                className="flex w-full items-start gap-2 border-b last:border-b-0 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="flex-1">
                    <div className="text-xs text-slate-500">{s.appealOnly ? 'Existing appeal' : (s.offense?.description || s.offenseDescription || (s.studentOnly ? 'Student' : 'Violation'))}</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{s.student?.name || s.studentName || s.student?.lrn || s.student?.studentId || 'Unknown'}</div>
                    <div className="mt-1 text-xs text-slate-500">Case {idx + 1} • {formatDate(s.incidentDate || s.incident_date || s.createdAt || s.created_at) || '—'} • LRN: {s.student?.lrn || s.studentLrn || s.student?.studentId || '—'}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
          <div className="text-slate-500">Student: <span className="text-slate-700 font-medium">{form.studentName || '—'}</span></div>
          <div className="text-slate-500">LRN: <span className="text-slate-700 font-medium">{form.lrn || '—'}</span></div>
          <div className="text-slate-500">Section: <span className="text-slate-700 font-medium">{form.section || '—'}</span></div>
          <div className="text-slate-500">Violation: <span className="text-slate-700 font-medium">{form.offenseDescription || form.violationId || '—'}</span></div>
        </div>
      </div>

      <label className="text-xs">
        <div className="mb-1 font-medium">Appeal Reason</div>
        <textarea aria-invalid={!!fieldErrors.appealText} value={form.appealText} onChange={(e) => setForm((p) => ({ ...p, appealText: e.target.value }))} placeholder="Appeal reason" className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        {fieldErrors.appealText ? <div className="mt-1 text-rose-600 text-xs">{fieldErrors.appealText}</div> : null}
      </label>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={submitting} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit Appeal'}</button>
        <button type="button" onClick={() => { setForm({ violationId: '', appealText: '', lrn: '', studentName: '', section: '', offenseDescription: '', existingAppealId: null }); setFieldErrors({}); setError(''); setSearchQuery(''); setSuggestions([]); setShowSuggestions(false); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Reset</button>
      </div>
    </form>
  );
}
