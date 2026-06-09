# AdAudit Pro

AI-powered Google Ads account auditing SaaS platform. Connects to Google Ads accounts, analyzes campaign data using AI + audit rules, and generates findings, executive summaries, health scores, roadmaps, PDF reports, and shareable public reports.

## Tech Stack

**Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router, Axios, Recharts, Zustand, Framer Motion, Lucide React

**Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis, BullMQ, JWT, Google OAuth, Puppeteer, Anthropic Claude API

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (optional — mock mode works without DB)
- Redis (optional — falls back to in-memory simulation)

### 1. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your credentials. For local demo, defaults work with `USE_MOCK_DATA=true`.

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

API runs at `http://localhost:5000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with audit form |
| `/login` | Google OAuth / demo login |
| `/processing/:auditId` | Live audit processing with polling |
| `/dashboard/:auditId` | Full report dashboard |
| `/shared/:reportId` | Public shared report |
| `/settings` | User settings |

## API Routes

- `POST /api/auth/login` — Mock/demo login
- `GET /api/auth/google` — Google OAuth redirect
- `GET /api/auth/me` — Current user
- `POST /api/audit/start-demo` — Start demo audit (no auth)
- `POST /api/audit/start` — Start authenticated audit
- `GET /api/audit/status/:id` — Poll audit progress
- `GET /api/audit/report/:id` — Full report data
- `GET /api/audit/pdf/:id` — Download PDF
- `POST /api/audit/share` — Create shared report link
- `GET /api/audit/shared/:token` — Public shared report

## Database (Optional)

```bash
cd backend
npx prisma db push
npx prisma generate
```

Set `USE_MOCK_DATA=false` to use PostgreSQL instead of in-memory store.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Railway/Docker production deployment instructions.

## Demo Flow

1. Visit `http://localhost:5173`
2. Fill out the audit form and click **RUN FREE AUDIT NOW**
3. Watch live processing at `/processing/:auditId`
4. Auto-redirects to dashboard when complete
5. Share report or download PDF from dashboard

## Architecture

```
backend/src/
├── audit-engine/    # Modular audit modules + mock data
├── ai/              # Anthropic Claude integration
├── queues/          # BullMQ queue definitions
├── workers/         # Background job workers
├── routes/          # Express API routes
├── services/        # Business logic
└── middleware/      # JWT auth middleware

frontend/src/
├── pages/           # Route pages
├── components/      # Reusable UI components
├── hooks/           # useAuditPolling, etc.
├── store/           # Zustand auth + audit state
└── services/        # Axios API layer
```

## License

Private — AdAudit Pro MVP
