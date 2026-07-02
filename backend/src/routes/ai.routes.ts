import { Router, Response } from 'express';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { handleOptimizeAd, handleOptimizeAdStatus } from '../controllers/optimize-ad.controller.js';

const router = Router();

router.post('/optimize-ad', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAd(req, res);
});

router.get('/optimize-ad/status/:jobId', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAdStatus(req, res);
});

export default router;
