import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api.js';
import { optionalText } from '../../utils/optionalText.js';

export function LoginPage({ onLogin, onNavigate, errorMessage }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const loginBackgroundUrl = '/mpnag_bg.jpg';
  const loginLogoUrl = '/mpnag_logo.png';
  const recaptchaSiteKey = optionalText(import.meta.env.VITE_RECAPTCHA_SITE_KEY)?.replace(/\s+/g, '') || null;
  const recaptchaRequired = Boolean(recaptchaSiteKey);
  const recaptchaContainerRef = useRef(null);
  const recaptchaWidgetIdRef = useRef(null);
  const loginAlertRef = useRef(null);

  useEffect(() => {
    setError(errorMessage || '');
  }, [errorMessage]);

  useEffect(() => {
    const alertElement = loginAlertRef.current;
    if (!error || !alertElement || typeof alertElement.animate !== 'function') {
      return;
    }

    alertElement.animate(
      [
        { opacity: 0, transform: 'translateY(-22px) scale(0.985)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ],
      {
        duration: 280,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    );
  }, [error]);

  useEffect(() => {
    if (!recaptchaRequired) {
      setRecaptchaLoaded(true);
      return;
    }

    let cancelled = false;

    const loadScript = () =>
      new Promise((resolve, reject) => {
        if (window.grecaptcha?.render) {
          resolve(window.grecaptcha);
          return;
        }

        const scriptId = 'sdms-google-recaptcha';
        const existing = document.getElementById(scriptId);

        const handleLoad = () => resolve(window.grecaptcha);
        const handleError = () => reject(new Error('Failed to load Google reCAPTCHA.'));

        if (existing) {
          existing.addEventListener('load', handleLoad, { once: true });
          existing.addEventListener('error', handleError, { once: true });
          return;
        }

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
        document.head.appendChild(script);
      });

    const renderWidget = () => {
      if (cancelled || !window.grecaptcha || !recaptchaContainerRef.current || recaptchaWidgetIdRef.current !== null) {
        return;
      }

      recaptchaWidgetIdRef.current = window.grecaptcha.render(recaptchaContainerRef.current, {
        sitekey: recaptchaSiteKey,
        theme: 'light',
        callback: (token) => setRecaptchaToken(optionalText(token) || ''),
        'expired-callback': () => setRecaptchaToken(''),
        'error-callback': () => setRecaptchaToken('')
      });

      setRecaptchaLoaded(true);
    };

    loadScript()
      .then(() => {
        if (cancelled) return;
        if (window.grecaptcha?.ready) {
          window.grecaptcha.ready(renderWidget);
          return;
        }
        renderWidget();
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to load reCAPTCHA. Please refresh and try again.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recaptchaRequired, recaptchaSiteKey]);

  const resetRecaptcha = () => {
    const widgetId = recaptchaWidgetIdRef.current;
    if (widgetId === null || !window.grecaptcha?.reset) {
      return;
    }
    window.grecaptcha.reset(widgetId);
    setRecaptchaToken('');
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const safeUsername = username.trim();
    if (!safeUsername || !password) {
      setError('Enter your username/email and password.');
      return;
    }

    if (recaptchaRequired && !recaptchaToken) {
      setError('Please complete reCAPTCHA before logging in.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const loginPayload = {
        username: safeUsername,
        password
      };

      if (recaptchaToken) {
        loginPayload.recaptchaToken = recaptchaToken;
      }

      const payload = await apiRequest('/auth/login', {
        method: 'POST',
        auth: false,
        body: loginPayload
      });
      onLogin(payload);
    } catch (loginError) {
      const normalizedMessage = String(loginError?.message || '').trim();
      if (recaptchaRequired) {
        resetRecaptcha();
      }

      const isCredentialError = loginError?.status === 401 || /invalid credentials/i.test(normalizedMessage);
      if (isCredentialError) {
        setError('Wrong username or password. Please try again.');
      } else {
        setError(normalizedMessage || 'Login failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden px-4 py-8 sm:py-12"
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(8, 20, 35, 0.08) 0%, rgba(8, 20, 35, 0.16) 100%), url('${loginBackgroundUrl}')`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="absolute inset-0 bg-slate-900/0" aria-hidden="true" />

      {error ? (
        <div className="pointer-events-none absolute top-4 right-4 left-4 z-20 flex justify-center sm:top-6">
          <div
            ref={loginAlertRef}
            className="pointer-events-auto w-full max-w-[780px] rounded-2xl border border-rose-300/55 bg-rose-700/80 px-5 py-4 text-rose-50 shadow-xl shadow-rose-950/35"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">Login failed</p>
                <p className="text-base text-rose-50/95">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setError('')}
                className="rounded-md border border-rose-100/40 px-2.5 py-1 text-xs font-semibold text-rose-50 hover:bg-rose-500/35"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative z-10 mx-auto flex min-h-[82vh] max-w-6xl items-center justify-center">
        <section className="w-full max-w-[460px] rounded-[26px] border border-slate-200/24 bg-[rgba(35,39,42,0.7)] p-6 shadow-[0_28px_85px_rgba(2,6,23,0.62)] backdrop-blur-sm sm:p-8">
          <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-white/16 p-0 shadow-lg shadow-slate-950/35">
            <img src={loginLogoUrl} alt="MPNAG logo" className="h-full w-full rounded-full object-cover" />
          </div>

          <p className="mt-2 text-center text-sm font-semibold text-slate-50/95">MPNAG - Student Discipline Management System</p>

          <form onSubmit={onSubmit} className="mt-5 space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-200">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z" />
                </svg>
              </span>
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username or Email"
                autoComplete="username"
                className="w-full rounded-xl border border-slate-400/35 bg-slate-700/45 px-10 py-2.5 text-sm text-slate-50 placeholder:text-slate-200/80 outline-none transition focus:border-teal-300/80 focus:ring-2 focus:ring-teal-300/25"
              />
            </div>

            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-200">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0v3z" />
                </svg>
              </span>
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-400/35 bg-slate-700/45 py-2.5 pl-10 pr-3 text-sm text-slate-50 placeholder:text-slate-200/80 outline-none transition focus:border-teal-300/80 focus:ring-2 focus:ring-teal-300/25"
              />
            </div>

            <div className="rounded-2xl border border-slate-200/85 bg-slate-50/98 p-3 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              <div className="min-h-[78px]">
                {recaptchaRequired ? (
                  <>
                    <div ref={recaptchaContainerRef} className="mx-auto w-fit [transform:scale(0.96)] [transform-origin:top_center]" />
                    {!recaptchaLoaded ? <p className="mt-2 text-xs text-slate-500">Loading reCAPTCHA...</p> : null}
                    {recaptchaToken ? <p className="mt-1 text-xs font-medium text-emerald-600">Verification complete</p> : null}
                  </>
                ) : (
                  <p className="pt-1 text-sm font-medium text-amber-700">reCAPTCHA site key is not loaded. Restart frontend after setting VITE_RECAPTCHA_SITE_KEY.</p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || (recaptchaRequired && !recaptchaToken)}
              className="w-full rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Signing in...' : recaptchaRequired && !recaptchaToken ? 'Complete reCAPTCHA to continue' : 'Login Now'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => onNavigate('/forgot-password')}
              className="text-sm font-semibold text-slate-50 underline decoration-slate-100/75 underline-offset-4 hover:text-white"
            >
              Forgot Your Password?
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
