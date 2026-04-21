import { useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { AppShell } from '../../components/layout/AppShell.jsx';
import { apiRequest } from '../../services/api.js';

function StudentAppealForm() {
  const [violationId, setViolationId] = useState('');
  const [appealText, setAppealText] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiRequest('/appeals', {
        method: 'POST',
        body: { violationId, appealText }
      });
      setSuccess('Appeal submitted. Guidance will review it soon.');
      setViolationId('');
      setAppealText('');
    } catch (submitError) {
      setError(submitError.message || 'Failed to submit appeal');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <input
        required
        value={violationId}
        onChange={(event) => setViolationId(event.target.value)}
        placeholder="Violation UUID"
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <textarea
        required
        value={appealText}
        onChange={(event) => setAppealText(event.target.value)}
        placeholder="Explain your appeal"
        className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400">
        Submit Appeal
      </button>
    </form>
  );
}

export function StudentPage({ account, onNavigate, onLogout, path }) {
  const navItems = [
    { path: '/student/dashboard', label: 'Student Dashboard' },
    { path: '/student/violations', label: 'My Violations' },
    { path: '/student/appeals', label: 'My Appeals' },
    { path: '/student/messages', label: 'My Messages' }
  ];

  return (
    <AppShell
      title="Student Portal"
      subtitle="Modernized student-facing flow with parity route paths."
      navItems={navItems}
      activePath={path}
      onNavigate={onNavigate}
      onLogout={onLogout}
      account={account}
    >
      <SectionCard title="Student Access" description="Student-specific API endpoints are limited in the current backend; this portal keeps routes ready for integration.">
        <p className="text-sm text-slate-700">
          Signed in as <span className="font-semibold">{account?.fullName || account?.username}</span>. Current role: {account?.role}.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Next step: expose student-scoped endpoints (for violations/messages list) or map student accounts to student records for direct filtering.
        </p>
      </SectionCard>

      {path === '/student/appeals' ? (
        <SectionCard title="Submit Appeal" description="Students can still submit appeals using /api/appeals POST.">
          <StudentAppealForm />
        </SectionCard>
      ) : null}

      {path === '/student/dashboard' ? (
        <SectionCard title="Quick Summary">
          <p className="text-sm text-slate-700">Dashboard widgets for students will activate as soon as student-scoped analytics endpoints are available.</p>
        </SectionCard>
      ) : null}

      {path === '/student/violations' ? (
        <SectionCard title="My Violations">
          <p className="text-sm text-slate-700">Current backend violation endpoints require Guidance/Admin access. This route is scaffolded for future student filtering support.</p>
        </SectionCard>
      ) : null}

      {path === '/student/messages' ? (
        <SectionCard title="My Messages">
          <p className="text-sm text-slate-700">Message history for students will appear here once student-level retrieval is exposed by the backend.</p>
        </SectionCard>
      ) : null}
    </AppShell>
  );
}
