import React, { createContext, useContext, useState } from 'react';

const GUEST_ID_KEY = 'bettercart_guest_user_id';

function getOrCreateGuestId() {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [guestId] = useState(() => getOrCreateGuestId());

  const user = { id: guestId, email: guestId, name: 'אורח' };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: true,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
      authError: null,
      authChecked: true,
      appPublicSettings: null,
      logout: () => {
        if (confirm('מחיקת כל הנתונים המקומיים וחזרה לדף הבית?')) {
          Object.keys(localStorage)
            .filter(k => k.startsWith('bc2_'))
            .forEach(k => localStorage.removeItem(k));
          localStorage.removeItem(GUEST_ID_KEY);
          window.location.href = '/';
        }
      },
      navigateToLogin: () => { window.location.href = '/dashboard'; },
      checkUserAuth: () => {},
      checkAppState: () => {},
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
