import { Link } from 'react-router-dom';
import { Logo } from '../layout/Logo';

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalPageLayout({ title, lastUpdated, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-bg">
      <nav className="border-b border-border bg-navy/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted hover:text-white transition-colors">
              Home
            </Link>
            <Link to="/privacy" className="text-muted hover:text-white transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="text-muted hover:text-white transition-colors">
              Terms
            </Link>
            <Link to="/login" className="text-muted hover:text-white transition-colors">
              Login
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-orange text-[10px] font-bold uppercase tracking-wider mb-3">Legal</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{title}</h1>
        <p className="text-muted text-sm mb-10">Last updated: {lastUpdated}</p>
        <div className="space-y-8 text-body text-sm leading-relaxed">{children}</div>
      </main>

      <footer className="border-t border-border py-8 mt-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <Logo size="sm" showSubtitle={false} />
          </Link>
          <div className="flex flex-wrap justify-center gap-5 text-muted text-xs">
            <Link to="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link to="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
          <p className="text-muted text-xs">© 2026 AdAudit Pro</p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-white font-semibold text-base mb-3">{title}</h2>
      <div className="space-y-3 text-body">{children}</div>
    </section>
  );
}
