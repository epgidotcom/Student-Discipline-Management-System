import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../services/api.js';
import { ErrorBanner } from '../common/ErrorBanner.jsx';
import { SuccessBanner } from '../common/SuccessBanner.jsx';

function Modal({ isOpen, title, onClose, children }) {
  if (!isOpen || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between bg-gradient-to-r from-teal-700 to-cyan-600 px-4 py-3 text-white">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xl font-bold">×</button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function normalizeStudent(row) {
  const fullName = (row?.fullName || row?.full_name || `${row?.firstName || ''} ${row?.lastName || ''}`).trim();
  return {
    id: row?.id || row?.student_uuid || '',
    fullName: fullName || 'Unknown Student',
    lrn: row?.lrn || ''
  };
}

export default function AppealModal({ isOpen, violation, onClose, onSuccess }) {
  const [studentQuery, setStudentQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [appealText, setAppealText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const seqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setStudentQuery('');
      setSuggestions([]);
      setSelectedStudent(null);
      setAppealText('');
      setError('');
      setSuccess('');
    }
  }, [isOpen]);

  useEffect(() => {
    const q = studentQuery.trim();
    if (!isOpen || q.length < 2) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      return undefined;
    }

    const sequence = ++seqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        setIsLoadingSuggestions(true);
        const params = new URLSearchParams({ page: '1', limit: '8', active: 'true', q });
        const payload = await apiRequest(`/students?${params.toString()}`);
        if (sequence !== seqRef.current) return;
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
        setSuggestions(rows.map(normalizeStudent));
      } catch {
        if (sequence !== seqRef.current) return;
        setSuggestions([]);
      } finally {
        if (sequence === seqRef.current) setIsLoadingSuggestions(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [studentQuery, isOpen]);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccess('');

    if (!violation?.id) {
      setError('Missing violation context');
      return;
    }

    if (!appealText.trim()) {
      setError('Appeal text is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const body = {
        violationId: violation.id,
        studentId: selectedStudent?.id || null,
        appealText: appealText.trim()
      };

      await apiRequest('/appeals', { method: 'POST', body });
      setSuccess('Appeal created');
      setAppealText('');
      setSelectedStudent(null);
      if (typeof onSuccess === 'function') onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to create appeal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Create Appeal" onClose={onClose}>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <form onSubmit={submit} className="grid gap-3">
        <div>
          <label className="text-sm font-semibold text-slate-800">Violation</label>
          <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{violation ? (violation.offenseDescription || violation.id) : '—'}</div>
        </div>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block font-semibold text-slate-800">Student (optional)</span>
          <input
            value={studentQuery}
            onChange={(ev) => setStudentQuery(ev.target.value)}
            placeholder="Type LRN or name to search"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
          />
          {isLoadingSuggestions ? <div className="text-xs text-slate-500 mt-1">Searching...</div> : null}
          {suggestions.length ? (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {suggestions.map((s) => (
                <button type="button" key={s.id} onClick={() => { setSelectedStudent(s); setStudentQuery(s.fullName); setSuggestions([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <div className="font-semibold">{s.fullName}</div>
                  <div className="text-xs text-slate-500">{s.lrn ? `LRN: ${s.lrn}` : 'No LRN'}</div>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label className="text-sm text-slate-700">
          <span className="mb-1 block font-semibold text-slate-800">Appeal Reason</span>
          <textarea required value={appealText} onChange={(e) => setAppealText(e.target.value)} placeholder="Explain why this case should be reviewed" className="min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none" />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSubmitting} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">{isSubmitting ? 'Submitting...' : 'Create Appeal'}</button>
        </div>
      </form>
    </Modal>
  );
}
