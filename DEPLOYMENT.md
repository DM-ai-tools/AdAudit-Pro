## Deployment (Railway)

AdAudit Pro ships as a **single Docker service**: Express API + built React frontend on one port.

### Railway setup

1. Create a new Railway project and connect this repository.
2. Railway detects `Dockerfile` / `railway.toml` automatically.
3. Add a **PostgreSQL** plugin and link `DATABASE_URL`.
4. Set environment variables (see below and `.env.example`).
5. Add your Railway public URL to Google Cloud OAuth **Authorized redirect URIs**:
   `https://<your-domain>/api/auth/google/callback`
6. Deploy — Railway sets `PORT` and `RAILWAY_PUBLIC_DOMAIN`.

### Required production variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `production` (set in Dockerfile) |
| `DATABASE_URL` | PostgreSQL connection string (Railway Postgres plugin) |
| `JWT_SECRET` | Strong random secret for session tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | Claude API key for AI audit modules |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |

### Recommended production variables

| Variable | Description |
|----------|-------------|
| `CLIENT_URL` | `https://<your-domain>.up.railway.app` (auto from `RAILWAY_PUBLIC_DOMAIN` if unset) |
| `GOOGLE_REDIRECT_URI` | `https://<domain>/api/auth/google/callback` (auto if unset) |
| `USE_MOCK_DATA` | `false` for production audits (default in production when unset) |

### Optional variables

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis for BullMQ background workers (omit to use in-memory audit runner) |
| `GOOGLE_ADS_MANAGER_ACCOUNT_ID` | MCC account ID if using manager accounts |
| `ANTHROPIC_API_KEY_2/3/4` | Parallel Claude keys for faster audits |

### Do NOT set in production

| Variable | Why |
|----------|-----|
| `REDIS_HOST=127.0.0.1` | No Redis inside the container — causes connection errors |
| `CLIENT_URL=http://localhost:5173` | Breaks OAuth redirects and CORS |

### Local production test

```bash
npm run install:all
npm run build
NODE_ENV=production PORT=5000 npm run start
# App + API at http://localhost:5000
```

### Docker

```bash
npm run docker:build
npm run docker:run
# or
docker compose up --build
```

### Health check

`GET /api/health` — used by Railway and Docker healthchecks.

### First deploy database

After linking PostgreSQL, run once locally or via Railway shell:

```bash
cd backend && npx prisma db push
```
