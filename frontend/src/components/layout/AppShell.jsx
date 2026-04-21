import { useEffect, useState } from 'react';

const THEME_KEY = 'sdms-theme';

function resolveInitialTheme() {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4.3" />
      <path strokeLinecap="round" d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.45 5.45l1.7 1.7M16.85 16.85l1.7 1.7M18.55 5.45l-1.7 1.7M7.15 16.85l-1.7 1.7" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.2a8.3 8.3 0 1 1-10.2-10 7 7 0 1 0 10.2 10Z" />
      <path strokeLinecap="round" d="M14.3 5.8v1.1M13.75 6.35h1.1" />
      <path strokeLinecap="round" d="M17.4 8.1v1.1M16.85 8.65h1.1" />
    </svg>
  );
}

export function AppShell({ title, subtitle, navItems, activePath, onNavigate, onLogout, account, children }) {
  const [theme, setTheme] = useState(resolveInitialTheme);
  const isDark = theme === 'dark';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const shellClasses = isDark
    ? {
      rootText: 'text-slate-100',
      header: 'border-slate-700/80 bg-slate-900/80 shadow-slate-950/35',
      account: 'border border-slate-700/80 bg-slate-800/90 text-slate-100',
      accountSub: 'text-slate-300',
      logout: 'bg-rose-600 hover:bg-rose-700',
      aside: 'border-slate-700/70 bg-slate-900/75 shadow-slate-950/25',
      navInactive: 'text-slate-200 hover:bg-slate-800/90',
      main: 'border-slate-700/70 bg-slate-900/75 shadow-slate-950/30',
      subtitle: 'text-slate-300',
      heading: 'text-teal-300',
      title: 'text-white'
    }
    : {
      rootText: 'text-slate-900',
      header: 'border-white/50 bg-white/80 shadow-amber-950/10',
      account: 'bg-slate-900 text-slate-100',
      accountSub: 'text-slate-300',
      logout: 'bg-rose-600 hover:bg-rose-700',
      aside: 'border-white/60 bg-white/75 shadow-teal-900/10',
      navInactive: 'text-slate-700 hover:bg-slate-100',
      main: 'border-white/60 bg-white/75 shadow-amber-900/10',
      subtitle: 'text-slate-600',
      heading: 'text-teal-700',
      title: 'text-slate-900'
    };

  return (
    <div className={`min-h-screen ${shellClasses.rootText}`}>
      <div className="ambient-bg" />
      <div className="relative mx-auto max-w-[1600px] px-3 pb-6 pt-4 sm:px-4 lg:px-6">
        <header className={`rounded-3xl border px-5 py-4 shadow-xl backdrop-blur ${shellClasses.header}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${shellClasses.heading}`}>Student Discipline Management</p>
              {title ? <h1 className={`mt-1 font-display text-2xl ${shellClasses.title}`}>{title}</h1> : null}
              {subtitle ? <p className={`mt-1 text-sm ${shellClasses.subtitle}`}>{subtitle}</p> : null}
              <div className={`mt-2 inline-block rounded-2xl px-4 py-2 text-left text-xs ${shellClasses.account}`}>
                <p className="font-semibold">{account?.fullName || account?.username || 'SDMS User'}</p>
                <p className={shellClasses.accountSub}>{account?.role || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                className={`relative h-14 w-[220px] rounded-full border px-6 text-center text-sm font-semibold tracking-[0.08em] transition-all ${
                  isDark
                    ? 'border-slate-600 bg-slate-700 text-slate-100'
                    : 'border-slate-300 bg-slate-100 text-slate-700'
                }`}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              >
                <span className="relative z-10">{isDark ? 'NIGHT MODE' : 'DAY MODE'}</span>
                <span
                  className={`absolute top-1 grid h-12 w-12 place-items-center rounded-full border text-slate-700 transition-all duration-300 ${
                    isDark
                      ? 'left-1 border-slate-500 bg-slate-100'
                      : 'left-[calc(100%-3.25rem)] border-slate-300 bg-white'
                  }`}
                >
                  {isDark ? <MoonIcon /> : <SunIcon />}
                </span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${shellClasses.logout}`}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="mt-4 grid gap-4 lg:grid-cols-125px_minmax(0,1fr)] xl:grid-cols-[125px_minmax(0,1fr)]">
          <aside className={`rounded-3xl border p-3 shadow-xl backdrop-blur ${shellClasses.aside}`}>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = activePath === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      isActive
                        ? 'bg-teal-700 text-white shadow-md shadow-teal-900/30'
                        : shellClasses.navInactive
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className={`rounded-3xl border p-4 shadow-xl backdrop-blur sm:p-5 ${shellClasses.main}`}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
