# TGlobal Gold Loan Portal

Monorepo scaffold for the TGlobal gold-loan portal assignment.

## Local setup

1. Install Node.js 20 or newer and Docker Compose.
2. Start PostgreSQL 16 with `docker compose up -d db`.
3. Install dependencies with `npm install`.
4. Start the API and web development servers with `npm run dev`.
5. Open <http://localhost:5173>. The Vite proxy forwards `/api` requests to the API on port 3001.

The health endpoint is `GET /api/v1/health`. Copy `.env.example` to `.env` to override local defaults.

## Workspace commands

- `npm test` runs the workspace tests.
- `npm run typecheck` checks TypeScript in each workspace.
- `npm run lint` runs ESLint.
- `npm run eval` is a placeholder for the assignment's agent conversation evaluations.
- `npm run db:migrate` applies Prisma migrations; `npm run db:seed` seeds the loan schemes.

The test database is created by the PostgreSQL init script on first startup with a fresh Docker volume.
