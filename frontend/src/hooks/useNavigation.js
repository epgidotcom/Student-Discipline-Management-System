import { useEffect, useState } from 'react';

export function useNavigation() {
  const [locationState, setLocationState] = useState(() => ({
    path: window.location.pathname || '/login',
    search: window.location.search || ''
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocationState({
        path: window.location.pathname || '/login',
        search: window.location.search || ''
      });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState({}, '', nextPath);
    } else {
      window.history.pushState({}, '', nextPath);
    }
    setLocationState({
      path: window.location.pathname || '/login',
      search: window.location.search || ''
    });
  };

  return {
    ...locationState,
    navigate
  };
}
