# Wild Rift Macro Coach

A macro coaching app for League of Legends: Wild Rift — upload screenshots and get instant AI-powered macro advice, plus a chat interface for follow-up questions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/wild-rift-coach run dev` — run the frontend (port 21590)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `AI_INTEGRATIONS_OPENROUTER_BASE_URL` and `AI_INTEGRATIONS_OPENROUTER_API_KEY` — auto-provisioned by Replit

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS (dark tactical game UI)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (conversations + messages tables)
- AI: OpenRouter via Replit AI Integrations proxy (SSE streaming)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Drizzle DB schema (conversations.ts, messages.ts)
- `lib/integrations-openrouter-ai/` — OpenRouter client wrapper
- `artifacts/api-server/src/routes/coach/` — screenshot analysis + model listing
- `artifacts/api-server/src/routes/openrouter/` — conversation CRUD + SSE chat
- `artifacts/wild-rift-coach/src/pages/` — Coach page + Settings page

## Architecture decisions

- OpenRouter models fetched live from `openrouter.ai/api/v1/models` and cached in the frontend
- Selected model stored in `localStorage` key `wildrift_model`
- Image uploaded as base64 and sent to the API for vision-capable model analysis
- SSE streaming used for both one-click advice and chat responses
- Game context (location, objectives, time, champions) injected into AI system prompt for accuracy

## Product

- **Coach Page**: Upload a Wild Rift screenshot + fill in game context (location, role, objectives, gold diff), hit "Advise Me" for instant macro advice. Chat panel for follow-up questions.
- **Settings Page**: Searchable dropdown of all OpenRouter models with pricing info.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Vision analysis only works with models that support image inputs (e.g. `google/gemini-2.0-flash-001`, `anthropic/claude-3.5-sonnet`)
- SSE endpoints cannot use generated React Query hooks — always use raw `fetch` + `ReadableStream`
- After any OpenAPI spec change, re-run codegen: `pnpm --filter @workspace/api-spec run codegen`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
