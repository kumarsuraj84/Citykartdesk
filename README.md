# CityKart Desk

A single-tenant, in-house service-desk / ITSM app for CityKart (think an internal Jira
Service Management or Freshservice): service catalog, tickets ("requests"), tasks,
projects, multi-step approvals, SLAs with business-hours-aware escalation, an intake
inbox (email → ticket/task), knowledge base, DeskTime integration, reporting, and an
org-admin surface.

## Tech stack

- **Framework**: Next.js 16 (App Router, React Server Components + Server Actions), React 19, TypeScript
- **Database**: Supabase (PostgreSQL + Auth + Storage), run locally via the Supabase CLI/Docker
- **Styling**: Tailwind CSS 4 + shadcn/ui, `lucide-react` icons
- **Forms**: `react-hook-form` + `zod`
- **Deployment**: Railway (always-on Docker container) — see [`docs/RAILWAY-DEPLOYMENT.md`](docs/RAILWAY-DEPLOYMENT.md)

## Before writing any code

This Next.js version has breaking changes from what most training data reflects. Read
the relevant guide under `node_modules/next/dist/docs/` first, and see
[`AGENTS.md`](AGENTS.md) / [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
project's hard constraints (e.g. edge middleware lives in `proxy.ts`, not
`middleware.ts`).

## Getting started

1. Start the local Supabase stack (Postgres + Auth + Storage, via Docker):
   ```bash
   npx supabase start
   ```
2. Copy `.env.example` to `.env.local` and fill in the values `supabase start` printed
   (URL, anon key, service-role key), plus any integration secrets you need locally.
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000).

## Building

Use the direct binary invocation, not `npm run build` / `npx next build` — the
`.bin/next` shim is broken on the Node version this project targets:

```bash
node node_modules/next/dist/bin/next build
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full project context: stack, module
  map, auth/RLS model, critical constraints.
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema reference (tables, enums, RPCs, RLS,
  indexes).
- [`docs/RAILWAY-DEPLOYMENT.md`](docs/RAILWAY-DEPLOYMENT.md) — deployment, environment
  variables, and scheduled-job (cron) setup.
