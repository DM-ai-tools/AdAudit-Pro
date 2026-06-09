import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuditRun } from '../types';
import { authApi } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (token, user) => {
        localStorage.setItem('token', token);
        set({ token, user, isAuthenticated: true });
      },
      logout: () => {
        localStorage.removeItem('token');
        set({ token: null, user: null, isAuthenticated: false });
      },
      loadUser: async () => {
        const token = get().token || localStorage.getItem('token');
        if (!token) return;
        try {
          const { data } = await authApi.me();
          set({ user: data.user, token, isAuthenticated: true });
        } catch {
          get().logout();
        }
      },
    }),
    { name: 'adaudit-auth', partialize: (s) => ({ token: s.token, user: s.user, isAuthenticated: s.isAuthenticated }) }
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
