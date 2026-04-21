import { useMemo, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { apiRequest } from '../../services/api.js';

export function ForgotPasswordPage({ search, onNavigate }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const token = params.get('token') || '';
  const queryEmail = params.get('email') || '';

  const requestReset = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await apiRequest('/auth/request-reset', {
        method: 'POST',
        auth: false,
        body: { email }
      });
      setMessage('If this email exists, a reset link has been sent.');
    } catch (requestError) {
      setError(requestError.message || 'Failed to request reset');
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await apiRequest('/auth/reset', {
        method: 'POST',
        auth: false,
        body: {
          token,
          email: queryEmail,
          password
        }
      });
      setMessage('Password reset successful. You can now sign in.');
    } catch (resetError) {
      setError(resetError.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_15%,rgba(20,184,166,0.2),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.2),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-10">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/60 bg-white/85 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur sm:p-8">
        <h1 className="font-display text-3xl text-slate-900">Forgot Password</h1>

        <ErrorBanner message={error} />
        <SuccessBanner message={message} />

        {token && queryEmail ? (
          <form onSubmit={resetPassword} className="mt-4 space-y-3">
            <input disabled value={queryEmail} className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm" />
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? 'Updating...' : 'Reset Password'}
            </button>
          </form>
        ) : (
          <form onSubmit={requestReset} className="mt-4 space-y-3">
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Account email"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? 'Sending...' : 'Request Reset'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="mt-4 text-sm font-semibold text-teal-700 hover:text-teal-900"
        >
          Back to login
        </button>
      </div>
    </div>
  );
}
