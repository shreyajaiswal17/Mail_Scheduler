# Mail Scheduler

A distributed email scheduling and dispatch engine built with Node.js, Express, BullMQ, Redis, PostgreSQL (Prisma), Elasticsearch, and React (Vite + Tailwind CSS).

## Overview

Mail Scheduler provides automated email batching with persistent queueing, rate limiting, and full-text search. The architecture decouples submission from execution:
- **Outbox Pattern**: Outbox records are durably persisted in PostgreSQL before queue dispatches.
- **Rate Limiting**: Distributed token-bucket rate limiter backed by Redis with atomic Lua scripts to prevent remote SMTP quota exhaustion.
- **Elasticsearch Search**: Full-text indexing of email subjects, recipients, and bodies with real-time indexing pipeline.
- **Slack Alerting**: Asynchronous alerting into configured Slack workspace channels when sender rate limits or critical delivery thresholds are exceeded.

## System Architecture

```
                      +-------------------+
                      |   React (Vite)    |
                      +---------+---------+
                                | REST / OAuth
                                v
                      +-------------------+
                      | Express Backend   |
                      +---+---+---+---+---+
                          |   |   |   |
          +---------------+   |   |   +---------------+
          |                   |   |                   |
          v                   v   v                   v
   +-------------+    +---------+ +-------------+ +---------------+
   | PostgreSQL  |    |  Redis  | | BullMQ Queue| | Elasticsearch |
   |  (Prisma)   |    +---------+ +------+------+ +---------------+
   +-------------+                       |
                                         v
                              +--------------------+
                              | BullMQ Worker      |
                              +---------+----------+
                                        | SMTP / Slack
                                        v
                               +-----------------+
                               | Ethereal / Real |
                               | SMTP & Webhooks |
                               +-----------------+
```

## Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- npm

## Setup & Local Development

### 1. Infrastructure (PostgreSQL, Redis, Elasticsearch)

Start local infrastructure dependencies via Docker Compose:

```bash
docker-compose up -d
```

Services exposed:
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Elasticsearch: `localhost:9200`

### 2. Backend Setup

```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
```

In a separate terminal, start the background worker:

```bash
cd backend
npm run worker
```

The API server runs at `http://localhost:5000`.

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend application runs at `http://localhost:5173`.

## Environment Variables

### Backend (`backend/.env`)

```ini
PORT=5000
DATABASE_URL="postgresql://reachinbox:reachinbox123@localhost:5432/reachinbox_mail?schema=public"
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_URL="http://localhost:9200"
JWT_SECRET="your-secure-jwt-secret-at-least-32-chars-long"
FRONTEND_URL="http://localhost:5173"

# Optional: Google OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_CALLBACK_URL="http://localhost:5000/api/auth/google/callback"

# Optional: Slack Integration
SLACK_CLIENT_ID=""
SLACK_CLIENT_SECRET=""
SLACK_REDIRECT_URI="http://localhost:5000/api/slack/oauth/callback"
```

## Core Endpoints

- `GET /health` - System health probe
- `GET /health/db` - PostgreSQL database connection check
- `POST /api/auth/login` - Email password-based session login
- `GET /api/auth/google` - Initiate Google OAuth authentication
- `GET /api/auth/me` - Retrieve authenticated user session
- `POST /api/emails/schedule` - Schedule email batch with delay and rate limits
- `GET /api/emails` - Retrieve and search scheduled/sent emails (via Elasticsearch)
- `GET /api/senders` - List configured SMTP senders
- `POST /api/senders` - Register/verify SMTP sender credentials
- `GET /api/slack/status` - Workspace Slack integration state
- `GET /admin/queues` - Bull Board dashboard for queue monitoring
