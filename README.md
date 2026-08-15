# options-copilot

Decision-support tool for **covered calls** and **cash-secured puts**. Read-only
analysis and manual position logging — no trade execution or brokerage
connectivity, and no other options strategies in scope.

## Stack

- Next.js 14 (App Router, TypeScript, Tailwind)
- Supabase (Postgres) for watchlist / positions / IV history
- Yahoo Finance (`yahoo-finance2`) and Finnhub for market data
- Deployed on Vercel

## Local setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

The app renders its full shell (nav, placeholder pages) with no env vars
set — Supabase and Finnhub are wired in later phases, so nothing here
requires live credentials yet.

## Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign in, and click **New
   project**.
2. Pick an organization, name the project (e.g. `options-copilot`), set a
   database password, and choose a region close to you.
3. Once the project is provisioned, open **Project Settings > API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only,
     never expose this to the client)

## Run the migration

The schema lives in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
and creates three tables: `watchlist`, `positions`, `iv_history`.

Using the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste the contents of the migration file directly into the Supabase
dashboard's **SQL Editor** and run it.

## Get a free Finnhub key

1. Go to [finnhub.io/register](https://finnhub.io/register) and create a
   free account.
2. Copy the API key from your [dashboard](https://finnhub.io/dashboard).
3. Set it as `FINNHUB_API_KEY` in `.env.local`.

## Set env vars in Vercel

In the Vercel project's **Settings > Environment Variables**, add the same
four variables from `.env.local.example`:

- `FINNHUB_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The app builds and deploys cleanly even before these are set — pages will
just show placeholder states until later phases wire up live data.

## Project structure

- `app/` — routes (App Router). API routes under `app/api/` are
  self-contained REST endpoints with no server-only React context, so they
  stay reusable by a future mobile client.
- `lib/` — plain TypeScript business logic (Supabase/Finnhub clients, and
  eventually P/L, delta/theta, and flagging logic) imported by API routes.
- `types/` — shared TypeScript types, including the hand-typed Supabase
  schema.
- `supabase/migrations/` — SQL migrations, applied manually for now.

---

**This is Phase 1 of 5** — foundation only. No live market data, no
Supabase writes, no decision logic yet. Just the app shell, schema, and
typed clients to build on.
