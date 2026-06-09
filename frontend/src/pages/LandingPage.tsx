import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle, Search, Shield, Zap, BarChart3, Target,
  FileText, Users, TrendingUp, Layers, MapPin,
  Eye, Layout, Sparkles, DollarSign, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const modules = [
  { icon: Layers, title: 'Campaign Structure', desc: 'Architecture, naming conventions, and campaign type analysis.', color: 'teal' },
  { icon: Search, title: 'Keyword Audit', desc: 'Match types, duplicates, and keyword relevance scoring.', color: 'orange' },
  { icon: Target, title: 'Search Term Waste', desc: 'Non-converting queries and negative keyword opportunities.', color: 'teal' },
  { icon: TrendingUp, title: 'Quality Score Analysis', desc: 'QS breakdown by keyword, ad relevance, and landing pages.', color: 'orange' },
  { icon: FileText, title: 'Ad Copy Audit', desc: 'AI-powered RSA analysis, ad strength, and messaging gaps.', color: 'teal' },
  { icon: DollarSign, title: 'Bidding Strategy', desc: 'Smart bidding readiness, bid adjustments, and CPA targets.', color: 'orange' },
  { icon: BarChart3, title: 'Budget Efficiency', desc: 'Budget allocation, capped campaigns, and spend pacing.', color: 'teal' },
  { icon: MapPin, title: 'Geo/Audience Audit', desc: 'Location targeting, audience layers, and demographic waste.', color: 'orange' },
  { icon: Users, title: 'Audience Targeting', desc: 'Remarketing lists, in-market segments, and observation layers.', color: 'teal' },
  { icon: Eye, title: 'Impression Share', desc: 'Lost IS analysis by budget, rank, and competitor pressure.', color: 'orange' },
  { icon: Layout, title: 'Landing Page Alignment', desc: 'Page speed, relevance, and conversion path analysis.', color: 'teal' },
  { icon: Sparkles, title: 'PMax Placements', desc: 'Brand cannibalization, asset group performance, and placement data.', color: 'orange' },
];

const footerLinks = {
  Product: [
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Audit Modules', href: '#modules' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Free Audit', href: '#audit-form' },
  ],
  Company: [
    { label: 'About Us', href: '#pricing' },
    { label: 'Contact', href: 'mailto:hello@adauditpro.com' },
    { label: 'Careers', href: '#' },
  ],
  Resources: [
    { label: 'Audit Checklist', href: '#modules' },
    { label: 'Google Ads Guide', href: '#how-it-works' },
    { label: 'FAQ', href: '#how-it-works' },
  ],
  Legal: [
    { label: 'Privacy Policy', href: '#' },
    { label: 'Terms of Service', href: '#' },
    { label: 'Cookie Policy', href: '#' },
  ],
};

export default function LandingPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    website: '',
    spend: '14200',
    goal: 'ecommerce',
    name: '',
    email: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate('/connect-account', { state: { formData: form } });
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* Top banner */}
      <div className="bg-gradient-to-r from-orange to-orange-2 text-white text-center py-2 text-sm">
        <span>🚀 New: AI-powered ad copy analysis with Claude — </span>
        <a href="#modules" className="underline font-semibold">Learn more</a>
      </div>

      {/* Nav */}
      <nav className="border-b border-border bg-navy/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo />
          <div className="hidden md:flex items-center gap-8 text-sm text-muted">
            <a href="#modules" className="hover:text-white transition-colors">Audit Modules</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">Case Studies</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-muted hover:text-white transition-colors">Login</Link>
            <Button size="sm" onClick={() => document.getElementById('audit-form')?.scrollIntoView({ behavior: 'smooth' })}>
              FREE AUDIT
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,107,43,0.08),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(139,92,246,0.05),transparent_60%)]" />
        <div className="max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center relative">
          <motion.div {...fadeUp}>
            <div className="inline-flex items-center gap-2 bg-orange/10 border border-orange/30 rounded-full px-3 py-1 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-orange animate-pulse-glow" />
              <span className="text-orange text-[10px] font-bold uppercase tracking-wider">
                AI-Powered · 12 Audit Modules · Instant Results
              </span>
            </div>
            <h1 className="text-4xl lg:text-5xl xl:text-[3.25rem] font-bold text-white leading-[1.1] mb-6">
              Stop <span className="text-gradient-orange">bleeding budget</span> on Google Ads that don't convert.
            </h1>
            <p className="text-body text-lg mb-8 leading-relaxed">
              AdAudit Pro runs a forensic audit of your Google Ads account — surfacing wasted spend,
              broken bidding, and missed opportunities — then gives you a prioritised 30/60/90-day fix roadmap.
            </p>
            <div className="space-y-3 mb-8">
              {[
                'Identifies 15–30% wasted spend on average across new accounts',
                'Covers 12 audit dimensions — structure, bidding, keywords, audiences & more',
                'Every finding ranked by financial impact — fix the biggest leaks first',
                'Done-For-You option — we implement every fix for you',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <CheckCircle size={18} className="text-teal shrink-0" />
                  <span className="text-body text-sm">{item}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Audit Modules', value: '12' },
                { label: 'Audit Delivery', value: '<4h' },
                { label: 'Avg ROAS Uplift', value: '+35%' },
                { label: 'Avg CPA Drop', value: '-25%' },
              ].map((stat) => (
                <div key={stat.label} className="text-center sm:text-left">
                  <div className="text-orange font-bold text-2xl">{stat.value}</div>
                  <div className="text-muted text-[10px] uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp} transition={{ delay: 0.2 }}>
            <Card className="glow-orange !p-0 overflow-hidden" id="audit-form">
              <div className="px-6 pt-5 pb-2">
                <div className="inline-flex items-center bg-orange/15 border border-orange/40 rounded px-2.5 py-1 mb-4">
                  <span className="text-orange text-[10px] font-bold uppercase tracking-wider">Free Audit · 60 sec</span>
                </div>
                <h3 className="text-white font-bold text-xl mb-1">Run your free Google Ads audit</h3>
                <p className="text-muted text-sm mb-5">
                  Connect your account, tell us about your goals, and AdAudit Pro handles the rest.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
                {/* Google Ads URL */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-body mb-1.5">
                    Google Ads Account URL or Domain <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://acmeplumbing.com.au"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    className="w-full bg-navy border border-border rounded-lg px-4 py-3 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
                  />
                </div>

                {/* Monthly Ad Spend */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-body">
                      Monthly Ad Spend
                    </label>
                    <span className="text-[10px] text-muted lowercase italic">approximate</span>
                  </div>
                  <div className="relative">
                    <select
                      value={form.spend}
                      onChange={(e) => setForm({ ...form, spend: e.target.value })}
                      className="w-full appearance-none bg-navy border border-border rounded-lg px-4 py-3 pr-10 text-white text-sm focus:outline-none focus:border-orange/50 cursor-pointer"
                    >
                      <option value="2500">Under $5,000 / month</option>
                      <option value="14200">$5,000 – $20,000 / month</option>
                      <option value="35000">$20,000 – $50,000 / month</option>
                      <option value="75000">$50,000 – $100,000 / month</option>
                      <option value="150000">$100,000+ / month</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  </div>
                </div>

                {/* Primary Campaign Goal */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-body mb-1.5">
                    Primary Campaign Goal
                  </label>
                  <div className="relative">
                    <select
                      value={form.goal}
                      onChange={(e) => setForm({ ...form, goal: e.target.value })}
                      className="w-full appearance-none bg-navy border border-border rounded-lg px-4 py-3 pr-10 text-white text-sm focus:outline-none focus:border-orange/50 cursor-pointer"
                    >
                      <option value="ecommerce">E-commerce / sales</option>
                      <option value="leads">Lead generation</option>
                      <option value="calls">Phone calls / local leads</option>
                      <option value="brand">Brand awareness</option>
                      <option value="app">App installs</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  </div>
                </div>

                {/* Your Name */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-body mb-1.5">
                    Your Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Jane Smith"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-navy border border-border rounded-lg px-4 py-3 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
                  />
                </div>

                {/* Work Email */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-body mb-1.5">
                    Work Email <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    placeholder="jane@acmeplumbing.com.au"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-navy border border-border rounded-lg px-4 py-3 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
                  />
                </div>

                <Button type="submit" size="lg" className="w-full uppercase tracking-wide">
                  <Search size={18} /> Start Free Google Ads Audit
                </Button>
                <p className="text-muted text-xs text-center leading-relaxed">
                  No credit card. Report delivered in{' '}
                  <span className="text-teal font-semibold">under 4 hours</span>.
                  {' '}We email you a permanent audit link.
                </p>
              </form>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Social proof metrics */}
      <section className="border-y border-border bg-navy/30 py-12">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: '$2.4M', label: 'Wasted spend identified' },
            { value: '+35%', label: 'Average increase in ROI' },
            { value: '-25%', label: 'Reduction in cost per lead' },
            { value: '98%', label: 'Accuracy in AI-driven insights' },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <div className="text-3xl font-bold text-white mb-1">{m.value}</div>
              <div className="text-muted text-xs uppercase tracking-wider">{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Four steps. One <span className="text-gradient-orange">forensic audit</span>. A clear fix roadmap.
          </h2>
          <div className="grid md:grid-cols-4 gap-6 mt-12">
            {[
              { num: '01', icon: Shield, title: 'Connect your account', desc: 'Secure OAuth connection to Google Ads. Read-only access, zero risk.', color: 'orange' },
              { num: '02', icon: Zap, title: 'AI audit runs', desc: '12 modules scan 100+ data points in parallel. Live progress tracking.', color: 'teal' },
              { num: '03', icon: FileText, title: 'Report created', desc: 'Detailed findings, health scores, and financial impact estimates.', color: 'orange' },
              { num: '04', icon: Target, title: 'Target the roadmap', desc: 'Execute the prioritized 30/60/90-day plan to recover wasted spend.', color: 'teal' },
            ].map((step, i) => (
              <motion.div key={step.num} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }}>
                <Card hover className="relative h-full">
                  <div className="text-5xl font-black text-border absolute top-4 right-4">{step.num}</div>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 ${step.color === 'orange' ? 'bg-orange/10' : 'bg-teal/10'}`}>
                    <step.icon size={20} className={step.color === 'orange' ? 'text-orange' : 'text-teal'} />
                  </div>
                  <h3 className="text-white font-bold mb-2">{step.title}</h3>
                  <p className="text-muted text-sm">{step.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Audit modules */}
      <section id="modules" className="py-20 bg-navy/20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Every layer of your account. <span className="text-gradient-orange">Every dollar accounted for.</span>
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-12">
            {modules.map((mod, i) => (
              <motion.div key={mod.title} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} viewport={{ once: true }}>
                <Card hover className="h-full">
                  <mod.icon size={20} className={mod.color === 'orange' ? 'text-orange mb-3' : 'text-teal mb-3'} />
                  <h3 className="text-white font-semibold text-sm mb-1">{mod.title}</h3>
                  <p className="text-muted text-xs leading-relaxed mb-3">{mod.desc}</p>
                  <span className="text-orange text-xs font-medium flex items-center gap-1">
                    Learn more <ChevronRight size={12} />
                  </span>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Report preview */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
          <div className="bg-panel border border-border rounded-xl p-4 glow-orange">
            <div className="bg-navy rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-sm">Account Health</span>
                <span className="text-orange font-bold text-2xl">38/100</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-panel rounded p-3 text-center"><div className="text-red-400 font-bold">31</div><div className="text-muted text-[10px]">Findings</div></div>
                <div className="bg-panel rounded p-3 text-center"><div className="text-teal font-bold">$4,820</div><div className="text-muted text-[10px]">Wasted</div></div>
                <div className="bg-panel rounded p-3 text-center"><div className="text-orange font-bold">14</div><div className="text-muted text-[10px]">High Priority</div></div>
              </div>
              {['Search term waste — $2,140/mo', 'Quality Score collapse — $980/mo', 'Smart Bidding misconfig — $720/mo'].map((f, i) => (
                <div key={f} className="flex items-center justify-between bg-panel/50 rounded p-3">
                  <span className="text-body text-xs">{f}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${i === 0 ? 'bg-red-500/20 text-red-400' : i === 1 ? 'bg-orange/20 text-orange' : 'bg-teal/20 text-teal'}`}>
                    {i === 0 ? 'HIGH' : i === 1 ? 'HIGH' : 'MEDIUM'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-6">
              A forensic report — not a generic checklist.
            </h2>
            <div className="space-y-4">
              {[
                '31 findings with financial impact estimates',
                'AI-generated executive summary',
                '30/60/90-day prioritized roadmap',
                'Health score breakdown by dimension',
                'Shareable stakeholder report',
                'Downloadable PDF export',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <CheckCircle size={18} className="text-teal shrink-0" />
                  <span className="text-body">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-navy/20">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Self-serve or <span className="text-gradient-orange">fully managed</span>. Same AI engine.
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <h3 className="text-white font-bold text-xl mb-1">AdAudit Pro SaaS</h3>
              <div className="text-3xl font-bold text-white mb-4">$2,997<span className="text-muted text-base font-normal">/year</span></div>
              <ul className="space-y-2 mb-6">
                {['Unlimited audits', '12 audit modules', 'PDF export', 'Shared reports', 'AI executive summaries'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-body"><CheckCircle size={14} className="text-teal" />{f}</li>
                ))}
              </ul>
              <Button variant="secondary" className="w-full">Get started</Button>
            </Card>
            <Card glow className="relative border-orange/30">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-orange text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase">Best Value</span>
              </div>
              <h3 className="text-white font-bold text-xl mb-1">AdAudit Pro DFY</h3>
              <div className="text-3xl font-bold text-white mb-4">$5,000<span className="text-muted text-base font-normal">/month</span></div>
              <ul className="space-y-2 mb-6">
                {['Everything in SaaS', 'Done-for-you implementation', 'Monthly re-audits', 'Dedicated strategist', 'Performance monitoring'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-body"><CheckCircle size={14} className="text-teal" />{f}</li>
                ))}
              </ul>
              <Button className="w-full">BOOK A STRATEGY CALL</Button>
            </Card>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-gradient-to-r from-orange to-orange-2 rounded-2xl p-10 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">
              Find out exactly where your Google Ads budget is leaking — and what it's costing you.
            </h2>
            <Button
              size="lg"
              variant="outline"
              className="!border-2 !border-white !text-white !bg-white/15 hover:!bg-white/25 hover:!text-white font-bold tracking-wide px-10 shadow-lg"
              onClick={() => document.getElementById('audit-form')?.scrollIntoView({ behavior: 'smooth' })}
            >
              RUN FREE AUDIT NOW
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Logo size="sm" />
            <p className="text-muted text-xs mt-4">© 2026 AdAudit Pro</p>
          </div>
          {Object.entries(footerLinks).map(([col, links]) => (
            <div key={col}>
              <h4 className="text-white text-sm font-semibold mb-3 uppercase tracking-wider">{col}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-muted text-sm hover:text-white transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
