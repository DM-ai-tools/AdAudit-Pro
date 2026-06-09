import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '../.env') });

const port = parseInt(process.env.PORT || '5000', 10);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const railwayPublicDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();

function resolvePublicUrl(): string {
  if (process.env.CLIENT_URL) return process.env.CLIENT_URL.trim();
  if (railwayPublicDomain) return `https://${railwayPublicDomain}`;
  return 'http://localhost:5173';
}

function resolveGoogleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}/api/auth/google/callback`;
  }
  return `http://localhost:${port}/api/auth/google/callback`;
}

function parseRedisConfig(): { host: string; port: number; password?: string } {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      /* fall through to host/port */
    }
  }
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

const redis = parseRedisConfig();
const clientUrl = resolvePublicUrl();
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

if (isProduction && jwtSecret === 'dev-secret-change-me') {
  console.warn('⚠ JWT_SECRET is using the default value — set a strong secret in production.');
}

export const env = {
  port,
  nodeEnv,
  isProduction,
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret,
  redisHost: redis.host,
  redisPort: redis.port,
  redisPassword: redis.password,
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleRedirectUri: resolveGoogleRedirectUri(),
  googleAdsDeveloperToken: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
  googleAdsManagerAccountId: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  clientUrl,
  railwayPublicDomain,
  useMockData: process.env.USE_MOCK_DATA !== 'false',
};
