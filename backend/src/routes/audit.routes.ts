import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import {
  startAudit,
  getAuditStatus,
  getAuditReport,
  getAuditLogs,
  getAuditHealth,
  createSharedReport,
  getSharedReport,
} from '../services/audit.service.js';

const router = Router();

router.post('/start', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const audit = await startAudit(req.authUser!.userId, req.body);
    res.status(201).json({ audit: sanitizeAudit(audit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

router.post('/start-demo', async (req, res) => {
  try {
    const { findOrCreateUser } = await import('../services/audit.service.js');
    const user = await findOrCreateUser(
      req.body.email || 'demo@acmeplumbing.com.au',
      req.body.name || 'Demo User'
    );
    const audit = await startAudit(user.id, req.body);
    res.status(201).json({ audit: sanitizeAudit(audit), auditId: audit.id });
  } catch {
    res.status(500).json({ error: 'Failed to start demo audit' });
  }
});

router.get('/status/:id', async (req, res) => {
  const audit = getAuditStatus(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ audit: sanitizeAudit(audit) });
});

router.get('/findings/:id', async (req, res) => {
  const audit = getAuditStatus(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ findings: audit.findings });
});

router.get('/report/:id', async (req, res) => {
  const audit = getAuditReport(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ audit: sanitizeAudit(audit) });
});

router.get('/logs/:id', async (req, res) => {
  const logs = getAuditLogs(req.params.id);
  res.json({ logs });
});

router.get('/health/:id', async (req, res) => {
  const health = getAuditHealth(req.params.id);
  if (!health) return res.status(404).json({ error: 'Audit not found' });
  res.json(health);
});

router.post('/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { auditRunId } = req.body;
  if (!auditRunId) return res.status(400).json({ error: 'auditRunId required' });
  const report = createSharedReport(auditRunId, req.authUser!.userId);
  res.json({ report, url: `/shared/${report.token}` });
});

router.get('/shared/:token', async (req, res) => {
  const data = getSharedReport(req.params.token);
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json({
    report: data.report,
    audit: sanitizeAudit(data.audit, true),
  });
});

router.get('/pdf/:id', async (req, res) => {
  try {
    const audit = getAuditReport(req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    const { generatePdf } = await import('../services/pdf.service.js');
    const pdf = await generatePdf(audit);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="adaudit-${audit.accountName.replace(/\s+/g, '-')}.pdf"`);
    res.send(pdf);
  } catch {
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

function sanitizeAudit(audit: ReturnType<typeof getAuditStatus>, shared = false) {
  if (!audit) return null;
  const metrics = audit.findings.reduce(
    (acc, f) => {
      acc.totalImpact += f.impactMonthly;
      if (f.severity === 'CRITICAL') acc.criticalCount++;
      return acc;
    },
    { totalImpact: 0, criticalCount: 0 }
  );

  const healthScore = audit.healthScores.length
    ? Math.round(audit.healthScores.reduce((s, h) => s + h.score, 0) / audit.healthScores.length)
    : 38;

  return {
    ...audit,
    healthScore,
    totalImpact: metrics.totalImpact,
    criticalCount: metrics.criticalCount,
    annualOpportunity: metrics.totalImpact * 12,
    findings: shared ? audit.findings.slice(0, 4) : audit.findings,
    totalFindings: audit.findings.length,
    hiddenFindings: shared ? Math.max(0, audit.findings.length - 4) : 0,
  };
}

export default router;
