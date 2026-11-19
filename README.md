# ReachInbox Email Job Scheduler & Dashboard

A full-stack, fault-tolerant email scheduling and campaign management service built with **TypeScript, Express.js, BullMQ, Redis, Prisma, React.js, and Tailwind CSS**.

## Key Features

- **Persistent Delayed Job Scheduling (BullMQ + Redis):** Schedules individual recipient emails with exact target timestamps and configurable inter-email delays without relying on in-memory cron jobs.
- **Startup Crash Recovery:** Automatically scans the database for pending `SCHEDULED` jobs on server restart and re-enqueues them idempotently (`jobId` deduplication) so zero emails are dropped or duplicated.
- **Atomic Per-Sender Hourly Rate Limiting:** Uses Redis `INCR` + `EXPIRE` counters keyed by `senderId` and UTC hour bucket (`YYYY-MM-DD-HH`). When a sender hits their hourly cap, remaining jobs are automatically rescheduled (`moveToDelayed`) to the next hour window.
- **Multi-Sender Ethereal SMTP & Live Previews:** Supports provisioning multiple Ethereal SMTP sender accounts and generates direct message preview links upon delivery.
- **Search & Observability:** Real-time dashboard tracking `SCHEDULED`, `SENT`, and `FAILED` statuses with Elasticsearch indexing and Slack webhook alerts.

---

## Tech Stack

- **Backend:** Node.js, Express.js, TypeScript, Prisma ORM (SQLite / PostgreSQL)
- **Queue & Rate Limiting:** BullMQ, Redis (`ioredis`)
- **Email & Integrations:** Nodemailer (Ethereal SMTP), Google OAuth 2.0, Elasticsearch, Slack Webhooks
- **Frontend:** React.js, TypeScript, Vite, Tailwind CSS

---

## Setup & Local Development

### 1. Prerequisites
- Node.js (v18+)
- Redis instance (Local Redis or Upstash Cloud Redis)
- Google OAuth 2.0 Client ID & Secret

### 2. Backend Setup
```bash
cd backend
npm install