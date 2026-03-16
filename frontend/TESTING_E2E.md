# Frontend E2E Testing (Playwright)

These tests run the real Next.js UI in a real browser while mocking backend APIs via Playwright network interception.

## Why this setup

- No Django/Celery/Ollama/Postgres dependency in CI.
- Real browser navigation and route-guard behavior are still exercised.
- API request payloads are asserted directly from captured outbound requests.

## Prerequisites

From `frontend/`:

```bash
bun install --frozen-lockfile
bunx playwright install chromium
```

If you run tests inside the project Docker environment, the frontend image now installs Playwright system dependencies and Chromium during image build.

```bash
docker-compose build frontend
docker-compose run --rm frontend bun run e2e
```

For CI (or first-time Linux setup with system deps):

```bash
bunx playwright install --with-deps chromium
```

## Running tests

```bash
cd frontend
bun run e2e
```

Useful variants:

```bash
bun run e2e:ui
bun run e2e:debug
```

## Environment variables

- `E2E_BASE_URL` (optional): defaults to `http://localhost:3001`.

Playwright `webServer` starts the app automatically via `bun run dev`. The default dev port in this project is `3001`.

## Auth bypass strategy

`e2e/helpers/network-mocks.ts` uses deterministic auth bypass by:

1. Creating a valid NextAuth session cookie (`next-auth.session-token`) so middleware route guards allow `/dashboard` and `/decks/*`.
2. Intercepting `/api/auth/session` to return a fixed session object.
3. Pre-seeding backend token localStorage keys and intercepting token exchange/refresh routes.

This avoids Google OAuth and backend auth dependencies.

## Mocked endpoints (discovered from FE code)

- `GET /api/auth/session`
- `POST /api/app/token/exchange`
- `POST /api/app/token/refresh`
- `GET /api/app/user/me/export/`
- `POST /api/app/user/me/delete-request/`
- `DELETE /api/app/user/me/`
