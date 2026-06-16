import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ConnectAccountPage from '../pages/ConnectAccountPage';
import LandingPage from '../pages/LandingPage';
import LoginPage from '../pages/LoginPage';
import ProcessingPage from '../pages/ProcessingPage';
import DashboardPage from '../pages/DashboardPage';
import SharedReportPage from '../pages/SharedReportPage';
import SettingsPage from '../pages/SettingsPage';
import { useAuthStore } from '../store';

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const authReady = useAuthStore((s) => s.authReady);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const store = useAuthStore.persist;
    if (store.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return store.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void loadUser();
  }, [hydrated, loadUser]);

  if (!hydrated || !authReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="skeleton w-48 h-6 rounded" />
      </div>
    );
  }

  return children;
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthBootstrap>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/connect-account" element={<ConnectAccountPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/processing/:auditId" element={<ProcessingPage />} />
          <Route path="/dashboard/:auditId" element={<DashboardPage />} />
          <Route path="/shared/:reportId" element={<SharedReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AuthBootstrap>
    </BrowserRouter>
  );
}
