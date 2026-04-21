import React from 'react';
import { formatDate } from '../../utils/formatDate.js';

export default function AppealList({ appeals = [], loading = false, error = '' }) {
  if (loading) return <p className="mt-2 text-sm text-slate-600">Loading appeals...</p>;
  if (error) return <p className="mt-2 text-sm text-rose-700">{error}</p>;

  if (!appeals || !appeals.length) {
    return <p className="mt-2 text-sm text-slate-600">No appeals found.</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      {appeals.map((a) => (
        <article key={a.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h5 className="text-lg font-semibold text-slate-900">Appeal — {a.status?.label || a.status?.code || 'Unknown'}</h5>
          <div className="mt-1 space-y-0.5 border-t border-slate-200 pt-1 text-sm text-slate-700">
            <div><strong>LRN:</strong> {a.student?.lrn || '-'}</div>
            <div><strong>Appeal Text:</strong> {a.appealText || '-'}</div>
            <div><strong>Offense:</strong> {a.offense?.description || '-'}</div>
            <div><strong>Filed On:</strong> {formatDate(a.createdAt) || '-'}</div>
          </div>
        </article>
      ))}
    </div>
  );
}
