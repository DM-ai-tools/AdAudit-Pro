import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '../.env') });

const port = parseInt(process.env.PORT || '5000', 10);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function resolveRailwayPublicDomain(): string {
  const explicit = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (explicit) return explicit;

  const staticUrl = (process.env.RAILWAY_STATIC_URL || '').trim();
  if (staticUrl) {
    try {
      return new URL(staticUrl).hostname;
    } catch {
      /* try next */
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('RAILWAY_SERVICE_') || !key.endsWith('_URL') || !value) continue;
    try {
      return new URL(value).hostname;
    } catch {
      /* try next */
    }
  }
  return '';
}

const railwayPublicDomain = resolveRailwayPublicDomain();

function resolvePublicUrl(): string {
  const explicit = (process.env.CLIENT_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const staticUrl = (process.env.RAILWAY_STATIC_URL || '').trim();
  if (staticUrl) return staticUrl.replace(/\/$/, '');

  if (railwayPublicDomain) return `https://${railwayPublicDomain}`;

  if (!isProduction) return 'http://localhost:5173';

  console.warn(
    '⚠ CLIENT_URL not set in production — set it to your Railway public URL (e.g. https://your-app.up.railway.app)'
  );
  return 'http://localhost:5173';
}

function resolveGoogleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  return `${resolvePublicUrl()}/api/auth/google/callback`;
}

function parseRedisConfig(): { host: string; port: number; password?: string } | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      console.warn('⚠ REDIS_URL is invalid — Redis disabled');
      return null;
    }
  }

  const redisHost = (process.env.REDIS_HOST || '').trim();
  if (redisHost && redisHost !== '127.0.0.1' && redisHost !== 'localhost') {
    return {
      host: redisHost,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  if (!isProduction && !redisHost) {
    return {
      host: '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  if (!isProduction && redisHost) {
    return {
      host: redisHost,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  return null;
}

const redis = parseRedisConfig();
const clientUrl = resolvePublicUrl();
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

const WEAK_JWT_SECRETS = new Set([
  'dev-secret-change-me',
  'adaudit-pro-dev-jwt-secret-change-in-production',
  'your-super-secret-jwt-key-change-in-production',
]);

if (isProduction && WEAK_JWT_SECRETS.has(jwtSecret)) {
  console.warn('⚠ JWT_SECRET is using a default value — set a strong secret in production.');
}

if (isProduction && clientUrl.includes('localhost')) {
  console.warn(
    '⚠ CLIENT_URL points to localhost in production — Google OAuth will fail. Set CLIENT_URL to your Railway URL.'
  );
}

/** BullMQ / Redis — only when explicitly configured (never default to localhost in production). */
export function isRedisConfigured(): boolean {
  return redis !== null;
}

export function resolveUseMockData(): boolean {
  if (process.env.USE_MOCK_DATA === 'true') return true;
  if (process.env.USE_MOCK_DATA === 'false') return false;
  return !isProduction;
}

export const env = {
  port,
  nodeEnv,
  isProduction,
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret,
  redisHost: redis?.host ?? '127.0.0.1',
  redisPort: redis?.port ?? 6379,
  redisPassword: redis?.password,
  redisConfigured: isRedisConfigured(),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleRedirectUri: resolveGoogleRedirectUri(),
  googleAdsDeveloperToken: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
  googleAdsManagerAccountId: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicParallelKeys: [
    process.env.ANTHROPIC_API_KEY_2,
    process.env.ANTHROPIC_API_KEY_3,
    process.env.ANTHROPIC_API_KEY_4,
  ]
    .map((k) => (k || '').trim())
    .filter(Boolean),
  clientUrl,
  railwayPublicDomain,
  useMockData: resolveUseMockData(),
};
