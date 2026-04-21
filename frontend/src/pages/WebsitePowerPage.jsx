import { AppShell } from '../components/layout/index.js';
import { AccountsPage, AppealsPage, DashboardPage, MessagesPage, SettingsPage, StudentsPage, ViolationsPage } from './admin/index.js';

export function WebsitePowerPage({ account, path, onNavigate, onLogout }) {
  const navItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/students', label: 'Students' },
    { path: '/violations', label: 'Violations' },
    { path: '/appeals', label: 'Appeals' },
    { path: '/messages', label: 'Messages' },
    { path: '/settings', label: 'Settings' },
    { path: '/accounts', label: 'Accounts' }
  ];

  return (
    <AppShell
      navItems={navItems}
      activePath={path}
      onNavigate={onNavigate}
      onLogout={onLogout}
      account={account}
    >
      {path === '/dashboard' ? <DashboardPage /> : null}
      {path === '/students' ? <StudentsPage /> : null}
      {path === '/violations' ? <ViolationsPage /> : null}
      {path === '/appeals' ? <AppealsPage /> : null}
      {path === '/messages' ? <MessagesPage /> : null}
      {path === '/settings' ? <SettingsPage /> : null}
      {path === '/accounts' ? <AccountsPage /> : null}
    </AppShell>
  );
}
