import { Router, Response } from 'express';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth.js';
import {
  startAudit,
  startCampaignAudit,
  getAuditStatus,
  getAuditReport,
  getAuditLogs,
  getAuditHealth,
  createSharedReport,
  getSharedReport,
  backfillAuditModules,
  backfillAuditModulesDemo,
  listUserAudits,
} from '../services/audit.service.js';
import type { AuditRun } from '../types/index.js';
import { handleOptimizeAd } from '../controllers/optimize-ad.controller.js';

const router = Router();

router.get('/list', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { audits, userEmail } = await listUserAudits(req.authUser!.userId, req.authUser!.email);
    res.json({ audits, userEmail });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load audits';
    const status = message.includes('authorized') || message.includes('not found') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/start', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const audit = await startAudit(req.authUser!.userId, req.body);
    res.status(201).json({ audit: sanitizeAudit(audit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

router.post('/start-campaign', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { parentAuditId, campaignId, campaignName } = req.body as {
      parentAuditId?: string;
      campaignId?: string;
      campaignName?: string;
    };
    if (!parentAuditId || !campaignId || !campaignName) {
      return res.status(400).json({ error: 'parentAuditId, campaignId, and campaignName are required' });
    }
    const audit = await startCampaignAudit(req.authUser!.userId, parentAuditId, {
      id: campaignId,
      name: campaignName,
    });
    res.status(201).json({ audit: sanitizeAudit(audit), auditId: audit.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start campaign audit';
    res.status(message.includes('not found') ? 404 : 500).json({ error: message });
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
  const audit = await getAuditStatus(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ audit: sanitizeAudit(audit) });
});

router.get('/findings/:id', async (req, res) => {
  const audit = await getAuditStatus(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ findings: audit.findings });
});

router.get('/report/:id', async (req, res) => {
  const audit = await getAuditReport(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json({ audit: sanitizeAudit(audit) });
});

router.get('/logs/:id', async (req, res) => {
  const logs = await getAuditLogs(req.params.id);
  res.json({ logs });
});

router.get('/health/:id', async (req, res) => {
  const health = await getAuditHealth(req.params.id);
  if (!health) return res.status(404).json({ error: 'Audit not found' });
  res.json(health);
});

router.post('/share-demo', async (req, res) => {
  const { auditRunId } = req.body;
  if (!auditRunId) return res.status(400).json({ error: 'auditRunId required' });
  const audit = await getAuditStatus(auditRunId);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  const report = await createSharedReport(auditRunId, audit.userId);
  res.json({ report, url: `/shared/${report.token}` });
});

router.post('/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { auditRunId } = req.body;
    if (!auditRunId) return res.status(400).json({ error: 'auditRunId required' });
    const report = await createSharedReport(auditRunId, req.authUser!.userId);
    res.json({ report, url: `/shared/${report.token}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create share link';
    const status = message.includes('not found') ? 404 : message.includes('authorized') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/:id/backfill-demo', async (req, res) => {
  try {
    const audit = await getAuditStatus(req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    const result = await backfillAuditModulesDemo(req.params.id);
    const updated = await getAuditReport(req.params.id);
    res.json({ ...result, audit: sanitizeAudit(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed';
    res.status(500).json({ error: message });
  }
});

router.post('/:id/backfill-modules', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await backfillAuditModules(req.params.id, req.authUser!.userId);
    const audit = await getAuditReport(req.params.id);
    res.json({ ...result, audit: sanitizeAudit(audit) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed';
    const status = message.includes('not found') ? 404 : message.includes('authorized') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

router.get('/shared/:token', async (req, res) => {
  const data = await getSharedReport(req.params.token);
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json({
    report: data.report,
    audit: sanitizeAudit(data.audit, true),
  });
});

router.get('/pdf/:id', async (req, res) => {
  try {
    const audit = await getAuditReport(req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    const { generatePdf } = await import('../services/pdf.service.js');
    const { buffer, isPdf } = await generatePdf(audit);
    const safeName = audit.accountName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    const inline = req.query.inline === '1' || req.query.view === 'inline' || !isPdf;
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="adaudit-${safeName}.${isPdf ? 'pdf' : 'html'}"`
    );
    res.send(buffer);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

/** Alias for /api/ai/optimize-ad — works even if ai router is not mounted */
router.post('/optimize-ad', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAd(req, res);
});

function sanitizeAudit(audit: AuditRun | null, shared = false) {
  if (!audit) return null;
  const validFindings = audit.findings.filter((f) => !/analysis incomplete|configure anthropic/i.test(f.title));
  const metrics = validFindings.reduce(
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
