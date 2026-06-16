import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';
import type { User, AuditRun } from '../types';
import { authApi, LAST_GOOGLE_EMAIL_KEY } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  hasGoogleAdsAccess: boolean;
  isReturningUser: boolean;
  sessionValid: boolean;
  authReady: boolean;
  setAuth: (token: string, user: User, hasGoogleAdsAccess?: boolean, isReturningUser?: boolean) => void;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      hasGoogleAdsAccess: false,
      isReturningUser: false,
      sessionValid: false,
      authReady: false,
      setAuth: (token, user, hasGoogleAdsAccess = false, isReturningUser = hasGoogleAdsAccess) => {
        localStorage.setItem('token', token);
        localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, user.email);
        set({
          token,
          user,
          isAuthenticated: true,
          hasGoogleAdsAccess,
          isReturningUser,
          sessionValid: hasGoogleAdsAccess,
          authReady: true,
        });
      },
      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          hasGoogleAdsAccess: false,
          isReturningUser: false,
          sessionValid: false,
          authReady: true,
        });
      },
      loadUser: async () => {
        // Prefer localStorage — written on every setAuth; survives refresh before zustand rehydrates.
        const token = localStorage.getItem('token') || get().token;
        if (!token) {
          set({
            authReady: true,
            isAuthenticated: false,
            hasGoogleAdsAccess: false,
            isReturningUser: false,
            sessionValid: false,
            user: null,
            token: null,
          });
          return;
        }
        localStorage.setItem('token', token);
        try {
          const { data } = await authApi.me();
          const adsAccess = data.hasGoogleAdsAccess && data.sessionValid !== false;
          set({
            user: data.user,
            token,
            isAuthenticated: true,
            hasGoogleAdsAccess: adsAccess,
            isReturningUser: data.isReturningUser && adsAccess,
            sessionValid: adsAccess,
            authReady: true,
          });
          if (data.user.email) {
            localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, data.user.email);
          }
        } catch (err) {
          const isUnauthorized =
            axios.isAxiosError(err) && err.response?.status === 401;
          if (isUnauthorized) {
            localStorage.removeItem('token');
            localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
            set({
              token: null,
              user: null,
              isAuthenticated: false,
              hasGoogleAdsAccess: false,
              isReturningUser: false,
              sessionValid: false,
              authReady: true,
            });
          } else {
            // Keep JWT on network errors — don't force OAuth again
            const cachedUser = get().user;
            set({
              token,
              user: cachedUser,
              isAuthenticated: true,
              hasGoogleAdsAccess: false,
              sessionValid: false,
              authReady: true,
            });
          }
        }
      },
    }),
    {
      name: 'adaudit-auth',
      partialize: (s) => ({
        token: s.token,
        user: s.user
          ? { id: s.user.id, email: s.user.email, name: s.user.name, avatarUrl: s.user.avatarUrl }
          : null,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AuthState>),
      }),
    }
  )
);

interface AuditState {
  currentAudit: AuditRun | null;
  setCurrentAudit: (audit: AuditRun | null) => void;
}

export const useAuditStore = create<AuditState>((set) => ({
  currentAudit: null,
  setCurrentAudit: (audit) => set({ currentAudit: audit }),
}));
