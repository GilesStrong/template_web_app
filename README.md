# myapp

## Fresh Clone Setup (Docker)

These steps assume the repo has just been cloned and you want to run the app locally with Docker.

### Dev Container (recommended in VS Code)

This repo includes a `.devcontainer` config.

1. Open the repo in VS Code.
2. Run **Dev Containers: Reopen in Container**.
3. Wait for the container to finish building.
4. Continue with the setup steps below from inside the devcontainer terminal.

Using the devcontainer gives you a consistent toolchain and avoids host dependency drift.

### 1) Prerequisites

- Docker + Docker Compose
- Google OAuth credentials (for login)
- An LLM service reachable on the external Docker network `llm_net` (required for deck generation)

### 2) Create env files

Backend env (repo root):

```bash
cp .env.tests .env
```

Frontend env:

```bash
cp frontend/.env.example frontend/.env
```

Then edit values as needed:

- In `.env`: backend/auth/API keys and Django/JWT settings
- In `frontend/.env`: Google OAuth + NextAuth settings (`NEXTAUTH_URL` should be `http://localhost:3000` for local)

### 2.1) Configure `AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS`

`AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS` controls which proxy IP ranges are trusted to provide forwarded client IP headers (such as `X-Forwarded-For` and `CF-Connecting-IP`) for auth rate limiting.

Use this rule:

- Include only proxy ranges that connect directly to Django (typically Caddy on the internal Docker network).
- Do **not** include broad/public ranges like `0.0.0.0/0`.

Examples:

- Single trusted proxy IP: `AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS=["172.30.5.10/32"]`
- Trusted Docker subnet: `AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS=["172.30.5.0/24"]`

How to discover values:

```bash
# Inspect subnet used by your compose network
docker network inspect myapp_prod_myapp_network_prod --format '{{(index .IPAM.Config 0).Subnet}}'

# Inspect proxy container IP on that network
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' myapp_prod-proxy-1
```

For local dev where direct spoofing risk is lower, you can keep this as an empty list (`[]`), but for staging/production set it explicitly.

### 2.2) Configure `ADMIN_ALLOWLIST_CIDRS`

`ADMIN_ALLOWLIST_CIDRS` controls which source CIDRs can access `/admin/*` through Caddy.

Format: space-separated CIDR list (not JSON).

Use this rule:

- Include only trusted operator/VPN/internal CIDRs.
- Do **not** use broad ranges like `0.0.0.0/0`.

Examples:

- Single office egress IP: `ADMIN_ALLOWLIST_CIDRS=198.51.100.44/32`
- Multiple ranges: `ADMIN_ALLOWLIST_CIDRS=198.51.100.44/32 10.42.0.0/16`

If no explicit value is provided in compose, the default is `127.0.0.1/32` (effectively closed to public traffic).

Quick start defaults:

- `cp .env.tests .env` gives you a backend baseline suitable for local/dev bootstrap.
- `cp frontend/.env.example frontend/.env` gives you the frontend baseline.
- You still need to fill real OAuth/API secrets before full auth + deck generation workflows will work.

### 3) Build and start services

```bash
docker compose up -d --build
```

### 4) Run database migrations

```bash
docker compose exec web python app/manage.py migrate
```

### 5) Open the app

- App URL: http://localhost:3000
- Backend health: http://localhost:3000/healthz

### 6) Useful dev commands

Stop services:

```bash
docker compose down
```

View logs:

```bash
docker compose logs -f web
docker compose logs -f frontend
docker compose logs -f celery_llm_worker
```

Run backend tests:

```bash
docker compose exec web python app/manage.py test
```

Run frontend tests:

```bash
docker compose exec frontend bun run test --run
```

## Production Server Commands

```bash
# start
docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml up -d --build
# check logs
docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml logs --tail=200 proxy
# restart
docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml up -d --force-recreate proxy
# stop
docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml down
```

### Cloudflared Tunnel Config

Create `.cloudflared/config.yml` with:

```yaml
tunnel: [tunnel_id]
credentials-file: /etc/cloudflared/[tunnel_id].json

ingress:
	- hostname: [host name]
	  service: http://proxy:3000
	- service: http_status:404
```

Set permissions:

```bash
chmod 700 .cloudflared
chmod 600 .cloudflared/config.yml
chmod 600 .cloudflared/[tunnel_id].json
chmod 600 .cloudflared/cert.pem
```

## Database backup and restore

Backup:

```bash
cd ~/dev/myapp

docker compose --env-file .env exec -T db \
  sh -lc 'pg_dump -U myapp_user -d myapp -Fc' > myapp_dev.dump

cp ~/dev/myapp/myapp_dev.dump ~/prod/myapp/
```

Restore:

```bash
cd ~/prod/myapp

docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  up -d db

docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  exec db \
  sh -lc 'psql -U myapp_user -d postgres -c "DROP DATABASE IF EXISTS myapp;"'

docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  exec db \
  sh -lc 'psql -U myapp_user -d postgres -c "CREATE DATABASE myapp;"'

cat myapp_dev.dump | docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  exec -T db \
  sh -lc 'pg_restore -U myapp_user -d myapp --no-owner --no-privileges'

docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  run --rm web python manage.py migrate

docker compose \
  --project-name myapp_prod \
  --env-file .env.prod \
  -f docker-compose.prod.yml \
  up -d
```

Then re-embed and upsert to qdrant as necessary
