import { Router, Response } from 'express';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { handleOptimizeAd } from '../controllers/optimize-ad.controller.js';

const router = Router();

router.post('/optimize-ad', optionalAuth, (req: AuthRequest, res: Response) => {
  void handleOptimizeAd(req, res);
});

export default router;
