# Mail Scheduler

A full-stack email scheduling platform built with React, Express, TypeScript, PostgreSQL, BullMQ, and Redis. Users can authenticate with Google, configure multiple SMTP senders, schedule email campaigns, monitor delivery status, search emails, and receive Slack notifications when hourly sending limits are reached.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16, Prisma 7 |
| Queue | BullMQ, Redis 7 |
| Email | Nodemailer, Ethereal SMTP |
| Search | Elasticsearch 8.17.3 |
| Authentication | Google OAuth, JWT |
| Notifications | Slack OAuth, Slack Web API |
| Monitoring | Bull Board |
| Infrastructure | Docker Compose |

## Features

- Google OAuth login and user-specific dashboard
- Multiple SMTP senders with encrypted credentials
- Email scheduling with CSV/text recipient upload
- Configurable start time, delay, and hourly limit
- Persistent delayed jobs with configurable worker concurrency
- Distributed rate limiting using Redis Lua scripts
- Transactional outbox and restart recovery
- Database leases and fencing tokens for worker safety
- Elasticsearch search with durable indexing recovery
- Real Slack OAuth and deduplicated hourly-limit alerts
- Bull Board queue monitoring

## Architecture

```text
React Dashboard
      |
      v
Express API
      |
      v
PostgreSQL
      |
      +----> Email Outbox ----> BullMQ + Redis
      |                              |
      |                              v
      |                         Email Worker
      |                              |
      |                       Redis Rate Limiter
      |                              |
      |                         Nodemailer
      |                              |
      |                         Ethereal SMTP
      |                              |
      |                         Status Update
      |
      +----> Search Outbox ----> Elasticsearch
      |
      +----> Slack Notification Outbox ----> Slack API
```

PostgreSQL is the source of truth. Redis stores queue and rate-limit state, while Elasticsearch maintains a searchable copy of email records.

## Local Setup

### Prerequisites

- Node.js and npm
- Docker Desktop
- Google Cloud OAuth credentials
- Ethereal SMTP account
- Slack App credentials for notification testing

### 1. Clone and start infrastructure

```bash
git clone https://github.com/shreyajaiswal17/Mail_Scheduler.git
cd Mail_Scheduler
docker compose up -d
```

Local services:

| Service | Address |
| --- | --- |
| PostgreSQL | `localhost:5433` |
| Redis | `localhost:6379` |
| Elasticsearch | `http://localhost:9200` |

### 2. Configure environment

Copy `backend/.env.example` to `backend/.env` and fill in the required credentials.

```env
PORT=5000
FRONTEND_URL=http://localhost:5173

DATABASE_URL=postgresql://reachinbox:<password>@localhost:5433/reachinbox
REDIS_URL=redis://localhost:6379

GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

JWT_SECRET=<strong-random-secret>
SMTP_ENCRYPTION_KEY=<64-character-hex-key>

SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<ethereal-username>
SMTP_PASS=<ethereal-password>

WORKER_CONCURRENCY=5
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=100

ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=mail-scheduler-emails

SLACK_CLIENT_ID=<slack-client-id>
SLACK_CLIENT_SECRET=<slack-client-secret>
SLACK_REDIRECT_URI=http://localhost:5000/api/slack/callback

ADMIN_EMAILS=<admin-google-email>
```

Refer to `.env.example` for the complete configuration. Never commit `.env` or expose credentials.

### 3. Install dependencies and apply migrations

```bash
cd backend
npm install

npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

### 4. Start the backend

```bash
npm run dev
```

In a separate terminal:

```bash
cd backend
npm run worker
```

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## OAuth & SMTP Setup

### Google OAuth

Configure the following authorized redirect URI in Google Cloud:

```text
http://localhost:5000/api/auth/google/callback
```

Google OAuth is used for authentication only. SMTP senders are configured separately.

### Ethereal SMTP

Create an account at [Ethereal Email](https://ethereal.email/) and configure its SMTP credentials through the dashboard. Ethereal accepts test emails and provides preview URLs without delivering messages to real inboxes.

### Slack OAuth

Create a Slack App and configure:

```text
Redirect URL:
http://localhost:5000/api/slack/callback
```

Add the required bot scopes, including `chat:write`, and configure the Slack credentials in `.env`. Connect the workspace from the dashboard, select a notification channel, and add the bot to that channel.

## Scheduling & Rate Limiting

The API validates the request and stores the campaign, individual email jobs, and outbox events in a PostgreSQL transaction. The outbox dispatcher then enqueues jobs in BullMQ using stable email IDs.

Workers process jobs at their scheduled time and enforce shared sender and campaign limits through an atomic Redis Lua script.

```env
WORKER_CONCURRENCY=5
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=100
```

When a limit is reached, the job is moved to BullMQ's delayed state rather than failed or discarded. The original `scheduledAt` is preserved, while `nextEligibleAt` tracks the next permitted attempt.

The limiter uses fixed UTC hourly windows and counts sending reservations/attempts rather than successful deliveries.

## Reliability & Persistence

### Transactional Outbox

PostgreSQL and Redis cannot share a single atomic transaction. The outbox ensures that an email and its queueing intent are saved together.

```text
PostgreSQL Transaction
    ├── EmailJob
    └── OutboxEvent → PENDING
              |
              v
        BullMQ Dispatcher
              |
              v
        OutboxEvent → DISPATCHED
```

Pending work can be recovered through reconciliation after application or dependency failures. No cron-based scheduling is used.

### Worker Safety

Workers use database claims, leases, and fencing tokens to reduce concurrent processing of the same email.

SMTP acceptance and database updates cannot be atomic. If a worker crashes after an SMTP attempt begins and the outcome is unknown, the email is moved to `NEEDS_REVIEW` instead of being blindly resent. This avoids claiming an unrealistic exactly-once delivery guarantee.

### Idempotency

Scheduling requests support user-scoped idempotency keys. Retrying the same request with the same key and payload returns the existing campaign; reusing the key with a different payload returns `409 Conflict`.

## Elasticsearch

Elasticsearch indexes safe email fields for text search, status filtering, sender filtering, date filtering, and pagination.

```text
GET /api/emails/search
```

Search queries are scoped to the authenticated user. Credentials and OAuth tokens are never indexed.

A PostgreSQL `SearchOutbox` records indexing intent. If Elasticsearch is unavailable, email sending continues and pending indexing updates can be recovered later. Cursor-based backfill supports existing records.

## Slack Notifications

Users connect their Slack workspace through OAuth and select a notification channel.

When a sender reaches its hourly limit:

```text
SENDER_HOURLY_LIMIT
        |
        +----> Email delayed in BullMQ
        |
        +----> SlackNotificationOutbox
                    |
                    v
               Slack Web API
                    |
                    v
             Configured channel
```

Alerts include the sender, hourly limit, and next eligible time. Redis-based deduplication prevents repeated alerts for the same user, sender, and hourly window.

Slack delivery is asynchronous and uses a durable outbox with bounded retries. Slack failures do not fail SMTP jobs.

## Bull Board

Queue monitoring is available at:

```text
http://localhost:5000/admin/queues
```

Access is restricted to authenticated administrators configured through `ADMIN_EMAILS`.

## Verification

The project includes scripts for search, Slack OAuth, Slack notifications, and Elasticsearch recovery.

```bash
cd backend

npx tsx src/scripts/verify-email-search.ts
npx tsx src/scripts/verify-slack-oauth.ts
npx tsx src/scripts/verify-slack-notifications.ts
```

The offline-recovery script intentionally simulates Elasticsearch downtime and should only be run in a controlled development environment.

The final demo covers Google login, sender configuration, scheduling, Scheduled/Sent views, Ethereal delivery, queue monitoring, restart recovery, search, and Slack alerts.

## Trade-offs

- **SMTP delivery:** Exactly-once delivery cannot be guaranteed across SMTP and PostgreSQL. Ambiguous attempts require review rather than automatic resend.
- **Rate limiting:** Quotas count dispatch attempts, and hourly windows are fixed UTC windows.
- **Search:** Elasticsearch is eventually consistent; PostgreSQL remains authoritative.
- **Infrastructure:** Docker Compose is intended for local development. Production deployment requires appropriate secrets management, TLS, backups, and network security.

## Author

Shreya Jaiswal
