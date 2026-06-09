import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ConnectAccountPage from '../pages/ConnectAccountPage';
import LandingPage from '../pages/LandingPage';
import LoginPage from '../pages/LoginPage';
import ProcessingPage from '../pages/ProcessingPage';
import DashboardPage from '../pages/DashboardPage';
import SharedReportPage from '../pages/SharedReportPage';
import SettingsPage from '../pages/SettingsPage';

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/connect-account" element={<ConnectAccountPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/processing/:auditId" element={<ProcessingPage />} />
        <Route path="/dashboard/:auditId" element={<DashboardPage />} />
        <Route path="/shared/:reportId" element={<SharedReportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
