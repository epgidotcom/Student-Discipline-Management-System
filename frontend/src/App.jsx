import { useCallback, useEffect, useState } from 'react';
import { WEBSITE_POWER_ROLES } from './constants/index.js';
import { useNavigation } from './hooks/index.js';
import { ForgotPasswordPage, LoginPage, StudentPage, WebsitePowerPage } from './pages/index.js';
import { AUTH_EXPIRED_EVENT, apiRequest, clearAuthPayload, getAuthPayload, saveAuthPayload } from './services/index.js';

function App() {
  const { path, search, navigate } = useNavigation();
  const [auth, setAuth] = useState(null);
  const [authBootstrapComplete, setAuthBootstrapComplete] = useState(false);
  const [routeError, setRouteError] = useState('');

  const account = auth?.account || null;
  const token = String(auth?.token || '').trim();
  const hasSession = Boolean(account && token);
  const role = String(account?.role || '').toLowerCase();
  const isStudent = role === 'student';
  const isWebsitePower = WEBSITE_POWER_ROLES.includes(role);
  const isStudentRoute = path === '/student' || path.startsWith('/student/');

  const handleLogout = useCallback(() => {
    clearAuthPayload();
    setAuth(null);
    setAuthBootstrapComplete(true);
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapSession = async () => {
      const existing = getAuthPayload();
      if (!existing?.token) {
        if (!cancelled) {
          setAuth(null);
          setAuthBootstrapComplete(true);
        }
        return;
      }

      try {
        const me = await apiRequest('/auth/me');
        if (cancelled) return;

        const hydratedPayload = {
          ...existing,
          account: me?.account || existing.account
        };
        saveAuthPayload(hydratedPayload);
        setAuth(hydratedPayload);
        setRouteError('');
      } catch (error) {
        if (cancelled) return;

        clearAuthPayload();
        setAuth(null);
        if (error.status && error.status !== 401) {
          setRouteError(error.message || 'Unable to validate session');
        }
      } finally {
        if (!cancelled) {
          setAuthBootstrapComplete(true);
        }
      }
    };

    bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authBootstrapComplete) {
      return;
    }

    const publicPaths = ['/login', '/forgot-password'];
    const isPublic = publicPaths.includes(path);

    if (!hasSession && !isPublic) {
      navigate('/login', { replace: true });
      return;
    }

    if (!hasSession && path === '/') {
      navigate('/login', { replace: true });
      return;
    }

    if (hasSession && path === '/') {
      navigate(isStudent ? '/student/dashboard' : '/dashboard', { replace: true });
      return;
    }

    if (hasSession && isStudent && !isStudentRoute) {
      navigate('/student/dashboard', { replace: true });
      return;
    }

    if (hasSession && !isStudent && isStudentRoute) {
      navigate('/dashboard', { replace: true });
    }
  }, [authBootstrapComplete, hasSession, isStudent, isStudentRoute, navigate, path]);

  useEffect(() => {
    const onAuthExpired = () => {
      setRouteError('Session expired. Please log in again.');
      handleLogout();
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    };
  }, [handleLogout]);

  const handleLogin = (payload) => {
    const saved = saveAuthPayload(payload);
    if (!saved) {
      handleLogout();
      return;
    }

    setAuth(saved);
    setAuthBootstrapComplete(true);
    const nextRole = String(saved?.account?.role || '').toLowerCase();
    navigate(nextRole === 'student' ? '/student/dashboard' : '/dashboard', { replace: true });
  };

  const onProtectedNavigate = async (nextPath) => {
    if (!token) {
      handleLogout();
      return;
    }

    // Navigate first so UI routing is responsive even if backend health checks are flaky.
    navigate(nextPath);

    try {
      await apiRequest('/auth/me');
      setRouteError('');
    } catch (error) {
      if (error.status === 401) {
        handleLogout();
      } else {
        setRouteError(error.message || 'Unable to validate session');
      }
    }
  };

  if (!authBootstrapComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-semibold text-slate-700 shadow">
          Checking session...
        </div>
      </div>
    );
  }

  if (path === '/login') {
    return <LoginPage onLogin={handleLogin} onNavigate={navigate} errorMessage={routeError} />;
  }

  if (path === '/forgot-password') {
    return <ForgotPasswordPage search={search} onNavigate={navigate} />;
  }

  if (!hasSession) {
    return <LoginPage onLogin={handleLogin} onNavigate={navigate} errorMessage={routeError} />;
  }

  if (isStudent) {
    return <StudentPage account={account} onNavigate={onProtectedNavigate} onLogout={handleLogout} path={path} />;
  }

  if (!isWebsitePower) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md rounded-2xl border border-rose-300 bg-white p-6 text-center shadow-lg">
          <h1 className="font-display text-2xl text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-600">Your role does not have website-power permissions in this workspace.</p>
          <button type="button" onClick={handleLogout} className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <WebsitePowerPage account={account} path={path} onNavigate={onProtectedNavigate} onLogout={handleLogout} />;
}

export default App;
