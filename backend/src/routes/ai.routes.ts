import { Router, Response, NextFunction } from 'express';
import { optionalAuth, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { handleOptimizeAd, handleOptimizeAdStatus } from '../controllers/optimize-ad.controller.js';
import {
  competitorDocumentUpload,
  handleParseCompetitorDocument,
} from '../controllers/competitor-document.controller.js';
import {
  handleSuggestCampaignCopy,
  handleSuggestCampaignCopyStatus,
} from '../controllers/suggest-campaign-copy.controller.js';
import {
  discoverServices,
  getKeywordClusters,
  recommendKeywordBids,
  discoverCompetitors,
  generateCampaignAds,
  refineCampaignAd,
} from '../services/campaign-wizard.service.js';
import {
  saveCampaignWizardActivity,
  type WizardActivityProcess,
} from '../services/campaign-wizard-activity.service.js';

const router = Router();

router.post('/optimize-ad', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAd(req, res);
});

router.get('/optimize-ad/status/:jobId', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAdStatus(req, res);
});

router.post('/suggest-campaign-copy', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleSuggestCampaignCopy(req, res);
});

router.get('/suggest-campaign-copy/status/:jobId', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleSuggestCampaignCopyStatus(req, res);
});

router.post(
  '/parse-competitors',
  optionalAuth,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    competitorDocumentUpload(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  (req: AuthRequest, res: Response) => {
    void handleParseCompetitorDocument(req, res);
  }
);

// ─── Campaign wizard endpoints ──────────────────────────────────

router.post('/campaign-wizard/discover-services', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { websiteUrl } = req.body as { websiteUrl?: string };
    if (!websiteUrl?.trim()) {
      res.status(400).json({ error: 'websiteUrl is required' });
      return;
    }
    const result = await discoverServices(websiteUrl.trim());
    res.json(result);
  } catch (err) {
    console.error('discover-services failed:', err);
    res.status(500).json({ error: 'Failed to extract services from website' });
  }
});

router.post('/campaign-wizard/keyword-clusters', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { websiteUrl, services, country, offer, dailyBudget, competitorSeeds, competitorNames, competitorAdTexts } =
      req.body as {
        websiteUrl?: string;
        services?: string[];
        country?: string;
        offer?: string;
        dailyBudget?: number;
        competitorSeeds?: Record<string, string[]>;
        competitorNames?: string[];
        competitorAdTexts?: string[];
      };
    if (!websiteUrl?.trim() || !services?.length) {
      res.status(400).json({ error: 'websiteUrl and services[] are required' });
      return;
    }
    const result = await getKeywordClusters(websiteUrl.trim(), services, {
      country,
      offer,
      dailyBudget,
      competitorSeeds,
      competitorNames,
      competitorAdTexts,
    });
    res.json(result);
  } catch (err) {
    console.error('keyword-clusters failed:', err);
    res.status(500).json({ error: 'Failed to fetch keyword clusters' });
  }
});

router.post('/campaign-wizard/keyword-recommendations', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { clusters, dailyBudget, campaignType, location, budgetContext, preferredStrategy } = req.body as {
      clusters?: Parameters<typeof recommendKeywordBids>[0]['clusters'];
      dailyBudget?: number;
      campaignType?: string;
      location?: string;
      preferredStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
      budgetContext?: Parameters<typeof recommendKeywordBids>[0]['budgetContext'];
    };
    if (!clusters?.length) {
      res.status(400).json({ error: 'clusters[] is required' });
      return;
    }
    const result = await recommendKeywordBids({
      clusters,
      dailyBudget,
      campaignType,
      location,
      preferredStrategy,
      budgetContext,
    });
    res.json(result);
  } catch (err) {
    console.error('keyword-recommendations failed:', err);
    res.status(500).json({ error: 'Failed to recommend keyword bidding strategy' });
  }
});

router.post('/campaign-wizard/discover-competitors', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { websiteUrl, service, keywords, country, offer, forceRefresh } = req.body as {
      websiteUrl?: string;
      service?: string;
      keywords?: string[];
      country?: string;
      offer?: string;
      forceRefresh?: boolean;
    };
    if (!websiteUrl?.trim() || !service?.trim()) {
      res.status(400).json({ error: 'websiteUrl and service are required' });
      return;
    }
    const result = await discoverCompetitors({
      websiteUrl: websiteUrl.trim(),
      service: service.trim(),
      keywords: keywords ?? [],
      offer: offer?.trim() || undefined,
      userId: req.authUser?.userId,
      country,
      forceRefresh: Boolean(forceRefresh),
    });
    res.json(result);
  } catch (err) {
    console.error('discover-competitors failed:', err);
    res.status(500).json({ error: 'Failed to discover competitors' });
  }
});

router.post('/campaign-wizard/generate-ads', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      companyName?: string;
      websiteUrl?: string;
      service?: string;
      keywords?: string[];
      competitors?: Array<{
        name: string;
        headlines: string[];
        descriptions: string[];
        totalAdCount: number;
        adDurationDays: number;
        isMostRelevant: boolean;
      }>;
      offer?: string;
      audience?: string;
      tone?: string;
      finalUrl?: string;
      locationFocus?: string;
    };
    if (!body.websiteUrl?.trim() || !body.service?.trim()) {
      res.status(400).json({ error: 'websiteUrl and service are required' });
      return;
    }
    const ads = await generateCampaignAds({
      companyName: body.companyName ?? '',
      websiteUrl: body.websiteUrl.trim(),
      service: body.service.trim(),
      keywords: body.keywords ?? [],
      competitors: (body.competitors ?? []).map((c) => ({
        ...c,
        url: '',
        activeAdCount: 0,
        allAds: [],
      })),
      offer: body.offer,
      audience: body.audience,
      tone: body.tone,
      finalUrl: body.finalUrl,
      locationFocus: body.locationFocus,
    });
    res.json({ ads });
  } catch (err) {
    console.error('generate-ads failed:', err);
    res.status(500).json({ error: 'Failed to generate ads' });
  }
});

router.post('/campaign-wizard/refine-ad', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      companyName?: string;
      websiteUrl?: string;
      service?: string;
      keywords?: string[];
      offer?: string;
      locationFocus?: string;
      instruction?: string;
      currentAd?: {
        id: string;
        label: string;
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
        keywords: string[];
        focusedCompetitor?: string;
      };
      chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!body.websiteUrl?.trim() || !body.service?.trim()) {
      res.status(400).json({ error: 'websiteUrl and service are required' });
      return;
    }
    if (!body.instruction?.trim()) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }
    if (!body.currentAd?.headlines?.length) {
      res.status(400).json({ error: 'currentAd with headlines is required' });
      return;
    }

    const result = await refineCampaignAd({
      companyName: body.companyName ?? '',
      websiteUrl: body.websiteUrl.trim(),
      service: body.service.trim(),
      keywords: body.keywords ?? [],
      offer: body.offer,
      locationFocus: body.locationFocus,
      instruction: body.instruction.trim(),
      currentAd: {
        id: body.currentAd.id,
        label: body.currentAd.label,
        headlines: body.currentAd.headlines,
        descriptions: body.currentAd.descriptions ?? [],
        displayPaths: body.currentAd.displayPaths,
        keywords: body.currentAd.keywords ?? [],
        focusedCompetitor: body.currentAd.focusedCompetitor,
      },
      chatHistory: body.chatHistory,
    });
    res.json(result);
  } catch (err) {
    console.error('refine-ad failed:', err);
    res.status(500).json({ error: 'Failed to refine ad copy' });
  }
});

router.post('/campaign-wizard/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      auditRunId?: string;
      googleAdsCustomerId?: string;
      mode?: 'campaign' | 'ad';
      stage?: 'in_progress' | 'campaign_created' | 'completed';
      title?: string;
      summary?: string;
      process?: WizardActivityProcess;
      campaignResourceName?: string;
      adResourceName?: string;
      campaignName?: string;
    };
    if (!body.mode || !body.stage || !body.title?.trim() || !body.process) {
      res.status(400).json({
        error: 'mode, stage, title, and process are required',
      });
      return;
    }
    if (!body.auditRunId?.trim() && !body.googleAdsCustomerId) {
      res.status(400).json({
        error: 'auditRunId or googleAdsCustomerId is required',
      });
      return;
    }
    const saved = await saveCampaignWizardActivity({
      userId: req.authUser!.userId,
      auditRunId: body.auditRunId?.trim(),
      googleAdsCustomerId: body.googleAdsCustomerId,
      mode: body.mode,
      stage: body.stage,
      title: body.title.trim(),
      summary: body.summary,
      process: body.process,
      campaignResourceName: body.campaignResourceName,
      adResourceName: body.adResourceName,
      campaignName: body.campaignName,
    });
    if (!saved) {
      res.status(400).json({ error: 'Could not attach wizard activity to an audit run' });
      return;
    }
    res.json({ success: true, id: saved.id });
  } catch (err) {
    console.error('campaign-wizard activity save failed:', err);
    res.status(500).json({ error: 'Failed to save campaign wizard activity' });
  }
});

export default router;
