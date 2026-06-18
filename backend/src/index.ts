import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { connectDatabase, importLegacyUsersIfEmpty } from './lib/database.js';
import authRoutes from './routes/auth.routes.js';
import googleAdsRoutes from './routes/google-ads.routes.js';
import auditRoutes from './routes/audit.routes.js';
import aiRoutes from './routes/ai.routes.js';
import { startWorkers } from './workers/audit.worker.js';

const app = express();
app.set('trust proxy', 1);
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '../../frontend/dist');

const corsOrigins = new Set<string>([env.clientUrl]);
if (!env.isProduction) {
  corsOrigins.add('http://localhost:5173');
  corsOrigins.add('http://localhost:3000');
  corsOrigins.add(`http://localhost:${env.port}`);
}
if (env.railwayPublicDomain) {
  corsOrigins.add(`https://${env.railwayPublicDomain}`);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, env.isProduction ? false : true);
  },
  credentials: true,
}));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  let database = false;
  if (env.databaseUrl) {
    try {
      const { prisma } = await import('./lib/prisma.js');
      await prisma.user.count();
      database = true;
    } catch {
      database = false;
    }
  }
  res.json({
    status: database ? 'ok' : 'degraded',
    mock: env.useMockData,
    database,
    version: '1.0.0',
    environment: env.nodeEnv,
    integrations: {
      googleOAuth: !!(env.googleClientId && env.googleClientSecret),
      anthropic: !!env.anthropicApiKey,
      googleAds: !!env.googleAdsDeveloperToken,
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/google-ads', googleAdsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/report', auditRoutes);
app.use('/api/shared', auditRoutes);

if (env.isProduction && existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(frontendDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await connectDatabase();
  await importLegacyUsersIfEmpty();

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`🚀 AdAudit Pro API running on port ${env.port}`);
    console.log(`   Environment: ${env.nodeEnv}`);
    console.log(`   Mock data: ${env.useMockData ? 'enabled' : 'disabled'}`);
    console.log(`   PostgreSQL: connected`);
    console.log(`   Redis: ${env.redisConfigured ? 'configured' : 'not configured (in-memory audits)'}`);
    console.log(`   Client URL: ${env.clientUrl}`);
    console.log(`   Google OAuth redirect: ${env.googleRedirectUri}`);
    console.log(`   Google OAuth: ${env.googleClientId && env.googleClientSecret ? 'configured' : 'not configured'}`);
    console.log(`   Anthropic AI: ${env.anthropicApiKey ? 'configured' : 'not configured'}`);
    if (env.isProduction && existsSync(frontendDist)) {
      console.log(`   Frontend static: serving from ${frontendDist}`);
    }
    startWorkers();
  }).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${env.port} is already in use by another process.`);
      console.error('   Stop the old backend first, then restart.\n');
      process.exit(1);
    }
    throw err;
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
