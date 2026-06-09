import { Link } from 'react-router-dom';
import { User, LogOut, Settings, Play } from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuthStore } from '../store';
import { auditApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

export default function SettingsPage() {
  const { user, logout, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  const handleStartAudit = async () => {
    try {
      const { data } = await auditApi.startDemo({
        email: user?.email,
        name: user?.name,
        accountName: 'Acme Plumbing AU',
      });
      navigate(`/processing/${data.auditId}`);
    } catch {
      navigate('/processing/demo');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Card className="text-center p-8">
          <p className="text-white mb-4">Please log in to access settings</p>
          <Link to="/login"><Button>Login</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-navy/50 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="sm" />
          <Link to="/" className="text-muted text-sm hover:text-white">← Home</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings size={24} className="text-orange" /> Settings
        </h1>

        <Card>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange/10 border border-orange/20 flex items-center justify-center">
              <User size={24} className="text-orange" />
            </div>
            <div>
              <div className="text-white font-semibold">{user?.name}</div>
              <div className="text-muted text-sm">{user?.email}</div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-white font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Button className="w-full" onClick={handleStartAudit}>
              <Play size={16} /> Start New Audit
            </Button>
            <Button variant="secondary" className="w-full" onClick={logout}>
              <LogOut size={16} /> Logout
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-white font-semibold mb-2">Connected Accounts</h2>
          <p className="text-muted text-sm mb-4">Acme Plumbing AU — $14,200/mo • 18 campaigns</p>
          <BadgeConnected />
        </Card>
      </div>
    </div>
  );
}

function BadgeConnected() {
  return (
    <span className="inline-flex items-center gap-1.5 text-teal text-xs font-semibold bg-teal/10 border border-teal/30 px-2 py-1 rounded">
      <span className="w-2 h-2 rounded-full bg-teal" /> Connected
    </span>
  );
}
