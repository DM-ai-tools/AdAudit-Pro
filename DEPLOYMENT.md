## Deployment (Railway)

AdAudit Pro ships as a **single Docker service**: Express API + built React frontend on one port.

### Railway setup

1. Create a new Railway project and connect this repository.
2. Railway detects `Dockerfile` / `railway.toml` automatically.
3. Set environment variables (see `.env.example`).
4. Add your Railway public URL to Google Cloud OAuth **Authorized redirect URIs**:
   `https://<your-domain>/api/auth/google/callback`
5. Deploy — Railway sets `PORT` and `RAILWAY_PUBLIC_DOMAIN`.

### Required production variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Strong random secret for session tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<domain>/api/auth/google/callback` |
| `CLIENT_URL` | Public app URL (or use `RAILWAY_PUBLIC_DOMAIN`) |
| `ANTHROPIC_API_KEY` | Claude API key for AI audit modules |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |

### Optional variables

| Variable | Description |
|----------|-------------|
| `USE_MOCK_DATA` | `true` (default) uses in-memory store; `false` for PostgreSQL |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ workers |
| `NODE_ENV` | Set to `production` in Railway |

### Local production test

```bash
npm run install:all
npm run build
NODE_ENV=production npm run start
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
