import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { queryClientInstance } from '@/lib/query-client';
import { UNAUTHORIZED_EVENT } from '@/lib/serverDB';

const AuthContext = createContext();

async function authRequest(path, body) {
  const res = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'אירעה שגיאה. נסו שוב.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Pages read `user.email` (query keys) — keep that shape for the signed-in account
const toUser = u => (u ? { id: u.id, email: u.email, name: u.email } : null);

export const AuthProvider = ({ children }) => {
  // 'loading' until /api/auth/me answers, so no page renders another user's cached data
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  const signIn = useCallback(u => {
    queryClientInstance.clear();
    setUser(toUser(u));
    setStatus('authenticated');
  }, []);

  const signOutLocally = useCallback(() => {
    queryClientInstance.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    let cancelled = false;
    authRequest('me')
      .then(({ user: u }) => { if (!cancelled) signIn(u); })
      .catch(() => { if (!cancelled) signOutLocally(); });
    return () => { cancelled = true; };
  }, [signIn, signOutLocally]);

  // Any API call answered with 401 (expired / deleted session) signs out locally
  useEffect(() => {
    const onUnauthorized = () => { if (status === 'authenticated') signOutLocally(); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [status, signOutLocally]);

  const login = async (email, password) => {
    const { user: u } = await authRequest('login', { email, password });
    signIn(u);
    return toUser(u);
  };

  const register = async (email, password) => {
    const { user: u } = await authRequest('register', { email, password });
    signIn(u);
    return toUser(u);
  };

  const logout = async () => {
    try { await authRequest('logout', {}); } finally { signOutLocally(); }
  };

  return (
    <AuthContext.Provider value={{
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isLoadingAuth: status === 'loading',
      login,
      register,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
