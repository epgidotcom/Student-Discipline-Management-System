import { useEffect, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { apiRequest } from '../../services/api.js';
import { optionalText } from '../../utils/optionalText.js';

export function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    username: '',
    password: '',
    role: 'Guidance',
    grade: ''
  });

  const loadAccounts = async () => {
    try {
      const payload = await apiRequest('/accounts');
      setAccounts(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load accounts');
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      await apiRequest('/accounts', {
        method: 'POST',
        body: {
          fullName: form.fullName,
          email: form.email,
          username: form.username,
          password: form.password,
          role: form.role,
          grade: optionalText(form.grade)
        }
      });

      setSuccess('Account created.');
      setForm({ fullName: '', email: '', username: '', password: '', role: 'Guidance', grade: '' });
      await loadAccounts();
    } catch (submitError) {
      setError(submitError.message || 'Failed to create account');
    }
  };

  return (
    <>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <SectionCard title="Accounts" description="Admin/Guidance account management flow preserved from the old create_account screen.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Username</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2">Role</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{account.fullName}</td>
                  <td className="py-2 pr-3">{account.username}</td>
                  <td className="py-2 pr-3">{account.email}</td>
                  <td className="py-2">{account.role}</td>
                </tr>
              ))}
              {!accounts.length ? (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-500">
                    No accounts available.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Create Account" description="Maintains backend contract for /api/accounts POST.">
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
          <input
            required
            value={form.fullName}
            onChange={(event) => setForm((previous) => ({ ...previous, fullName: event.target.value }))}
            placeholder="Full name"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            value={form.email}
            onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
            placeholder="Email"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            value={form.username}
            onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
            placeholder="Username"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            value={form.password}
            onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
            placeholder="Password"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={(event) => setForm((previous) => ({ ...previous, role: event.target.value }))}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="Admin">Admin</option>
            <option value="Guidance">Guidance</option>
            <option value="Student">Student</option>
          </select>
          <input
            value={form.grade}
            onChange={(event) => setForm((previous) => ({ ...previous, grade: event.target.value }))}
            placeholder="Grade (optional for student accounts)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 md:col-span-2">
            Create Account
          </button>
        </form>
      </SectionCard>
    </>
  );
}
