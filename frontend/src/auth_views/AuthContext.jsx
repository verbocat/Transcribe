import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchCurrentUser, logoutUser, submitTakeoverDecision } from './authService';
import { API_BASE } from '../config';
import DeviceTakeoverAlertModal from './DeviceTakeoverAlertModal';

const AuthContext = createContext(null);

const TOKEN_KEY = 'verbolabs_auth_token';
const USER_KEY = 'verbolabs_auth_user';
const LAST_ACTIVITY_KEY = 'verbolabs_last_activity';

// 4 Hours Inactivity Timeout (4 * 60 * 60 * 1000 = 14,400,000 ms)
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const [takeoverAlert, setTakeoverAlert] = useState(null);
  const lastRecordedActivityRef = useRef(Date.now());

  const clearSessionNotice = useCallback(() => {
    setSessionNotice('');
  }, []);

  const logout = useCallback(async (notice = '') => {
    const currentToken = token || localStorage.getItem(TOKEN_KEY);
    if (currentToken) {
      await logoutUser(currentToken);
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    if (notice) {
      setSessionNotice(notice);
    }
  }, [token]);

  // Throttled activity recorder (persists to localStorage at most once every 15 seconds)
  const recordActivity = useCallback(() => {
    if (!token) return;
    const now = Date.now();
    lastRecordedActivityRef.current = now;
    const stored = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
    if (now - stored > 15000) {
      localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    }
  }, [token]);

  // Check for 4-hour inactivity expiration
  const checkInactivityTimeout = useCallback(() => {
    if (!token) return;
    const now = Date.now();
    const stored = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
    const last = Math.max(stored, lastRecordedActivityRef.current);

    if (last > 0 && now - last >= INACTIVITY_TIMEOUT_MS) {
      console.warn('[VerboLabs Auth] Session timed out after 4 hours of inactivity');
      logout('Your session has expired after 4 hours of inactivity. Please log in again.');
    }
  }, [token, logout]);

  // Validate existing token with server on initial mount
  useEffect(() => {
    let isMounted = true;
    async function verifySession() {
      if (!token) {
        setIsLoading(false);
        return;
      }

      // First check local inactivity
      const stored = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
      if (stored > 0 && Date.now() - stored >= INACTIVITY_TIMEOUT_MS) {
        if (isMounted) {
          logout('Your session has expired after 4 hours of inactivity. Please log in again.');
          setIsLoading(false);
        }
        return;
      }

      try {
        const freshUser = await fetchCurrentUser(token);
        if (isMounted) {
          setUser((prev) => ({ ...(prev || {}), ...freshUser }));
          localStorage.setItem(USER_KEY, JSON.stringify({ ...(user || {}), ...freshUser }));
          localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
          lastRecordedActivityRef.current = Date.now();
        }
      } catch (err) {
        console.warn('Session verification note:', err);
        if (isMounted) {
          // Only invalidate local session if the backend explicitly tells us the token is invalid/unauthorized
          if (err.status === 401 || err.status === 403) {
            logout('Your session has expired. Please log in again.');
          } else {
            // Transient network error, 404 due to temporarily wrong URL, or server restarting: keep existing session
            console.warn('Backend verification skipped due to transient or network issue:', err.message);
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    verifySession();
    return () => {
      isMounted = false;
    };
  }, [token, logout]);

  // Set up global user activity listeners & periodic inactivity check
  useEffect(() => {
    if (!token) return;

    // Initialize last activity if not present
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const handleEvent = () => recordActivity();

    events.forEach((evt) => {
      window.addEventListener(evt, handleEvent, { passive: true });
    });

    // Check inactivity every 30 seconds
    const interval = setInterval(checkInactivityTimeout, 30000);

    // Check for incoming takeover requests from other devices every 5 seconds
    const takeoverInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 401) {
          // Session revoked or timed out
          logout('Your session was ended from another device or has expired. Please log in again.');
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.takeover_requested && data.takeover) {
            setTakeoverAlert(data.takeover);
          } else {
            setTakeoverAlert(null);
          }
        }
      } catch (err) {
        // Ignore network hiccups
      }
    }, 5000);

    // Also verify immediately when switching back to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkInactivityTimeout();
        recordActivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, handleEvent);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
      clearInterval(takeoverInterval);
    };
  }, [token, recordActivity, checkInactivityTimeout, logout]);

  const handleKeepWorking = useCallback(async (takeoverId) => {
    try {
      await submitTakeoverDecision({ takeover_id: takeoverId, decision: 'keep', token });
      setTakeoverAlert(null);
    } catch (err) {
      console.error('Failed to keep session:', err);
    }
  }, [token]);

  const handleLogOutNow = useCallback(async (takeoverId) => {
    try {
      await submitTakeoverDecision({ takeover_id: takeoverId, decision: 'release', token });
      setTakeoverAlert(null);
      logout('You chose to log out to allow the incoming device.');
    } catch (err) {
      logout();
    }
  }, [token, logout]);

  // Synchronize authentication state across multiple browser tabs/windows
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === TOKEN_KEY) {
        const storedToken = localStorage.getItem(TOKEN_KEY);
        setToken(storedToken);
      }
      if (e.key === USER_KEY) {
        const storedUser = localStorage.getItem(USER_KEY);
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const login = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setSessionNotice('');
    setTakeoverAlert(null);
    const now = Date.now();
    lastRecordedActivityRef.current = now;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: Boolean(token && user),
        isLoading,
        sessionNotice,
        clearSessionNotice,
        login,
        logout
      }}
    >
      <DeviceTakeoverAlertModal
        isOpen={Boolean(takeoverAlert)}
        takeover={takeoverAlert}
        onKeepWorking={handleKeepWorking}
        onLogOutNow={handleLogOutNow}
      />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
