# Template Web Frontend

## Overview

This frontend is a Next.js app intended to be reused as a template alongside the Django backend.

## Prerequisites

- Bun
- Google OAuth client credentials

## Environment variables

Create `frontend/.env` (or set vars in your shell) with:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ENFORCE_ALLOWED_EMAILS`
- `GOOGLE_ALLOWED_EMAILS`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (for local dev: `http://localhost:3001`)
- `BACKEND_INTERNAL_URL` (for server-side token exchange)

## Run locally

```bash
cd frontend
bun install --frozen-lockfile
bun run dev
```

App URL: `http://localhost:3001`

## Build for production

```bash
cd frontend
bun run build
bun run start
```

## Test

```bash
cd frontend
bun run test --run
```

## E2E

See `frontend/TESTING_E2E.md` for Playwright setup and how to add tests.
