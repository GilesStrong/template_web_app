# Deep MTG Frontend

## Development Setup

### Prerequisites
- Docker and Docker Compose installed
- Google OAuth credentials (Client ID and Secret)

### Environment Variables

1. Copy the example environment file:
```bash
cp frontend/.env.example frontend/.env
```

2. Edit `frontend/.env` and add your credentials:
- `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret
- `GOOGLE_ENFORCE_ALLOWED_EMAILS`: `true` to enforce allowlist, `false` to allow all Google users
- `GOOGLE_ALLOWED_EMAILS`: Comma-separated list of emails allowed to sign in via Google
- `NEXTAUTH_SECRET`: A random secret string (at least 32 characters)
- `NEXTAUTH_URL`: Should be `http://localhost:3000` for local dev
- `BACKEND_INTERNAL_URL`: Internal backend base URL for server-side token exchange (default: `http://web:8000`)
- `NEXT_PUBLIC_SUPPORT_EMAIL`: Public support email shown on the support page (optional)

### Running the Application

1. Start all services (backend, frontend, and proxy):
```bash
docker compose up
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

The reverse proxy (Caddy) handles routing:
- `/` → Next.js frontend
- `/api/auth/*` → NextAuth (Next.js)
- `/api/*` → Django backend

### Production Build

To build for production:
```bash
cd frontend
npm run build
npm run start
```

### Tech Stack

- **Next.js 16** with App Router
- **React 18**
- **TypeScript** (strict mode)
- **Tailwind CSS** for styling
- **shadcn/ui** for UI components
- **NextAuth** for Google OAuth authentication
- **Caddy** as reverse proxy in development

### Project Structure

```
frontend/
├── app/
│   ├── api/              # API route handlers (NextAuth)
│   ├── dashboard/        # Dashboard page (protected)
│   ├── decks/           # Deck view pages (protected)
│   ├── login/           # Login page
│   ├── layout.tsx       # Root layout
│   └── globals.css      # Global styles
├── components/
│   └── ui/              # shadcn/ui components
├── lib/
│   ├── auth.ts          # NextAuth configuration
│   └── utils.ts         # Utility functions
├── proxy.ts             # Route protection proxy
└── package.json
```

### Features

1. **Authentication**: Google OAuth login with NextAuth
4. **Protected Routes**: Automatic redirect to login for unauthenticated users

### Development Notes

- Frontend runs on internal port 3001
- Proxy exposes port 3000 to host
- Hot reload is enabled via volume mounts
- All API calls are same-origin to avoid CORS issues
