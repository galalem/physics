# Φysics — Galalem's physics learning platform

Interactive high-school physics for Tunisian secondary-school students.
125 handcrafted exercises spanning the full CNP curriculum, each one a
self-contained mini-game running in a sandboxed iframe. Trilingual
(English / French / Arabic) with full RTL support.

Every exercise follows an **Observe → Experiment → Evaluate** progression
and is driven by a seeded PRNG, so the same random-seeming setup is
deterministic and reproducible. The runtime is intentionally boring:
new exercises drop into a folder and ship independently of the LMS.

## Stack

- **Frontend** — Vite + React + TypeScript + `@galalem/react-localization`
- **Backend** — Node 22 + Hono, in-house auth (argon2id + opaque sessions)
- **Runtime** — sandboxed iframes per exercise, tiny postMessage protocol
- **Database** — Postgres 16 with `pg_trgm`
- **Payments** — Galalem Payments

## Layout

```
frontend/    LMS React app
backend/     Hono API
runtime/     Exercise SDK, host library, iframe protocol, container
exercises/   One folder per exercise
e2e/         Playwright end-to-end scenarios
scripts/     Scaffolders and one-off tools
```

## Getting started

```bash
pnpm install
```

Local development runs each service (frontend, backend, mail catcher,
runtime container) in its own terminal. See the individual `package.json`
files under `frontend/`, `backend/`, and `exercises/*/` for the concrete
scripts.

## Requirements

- Node 22+
- pnpm 9+
- Docker
- Postgres 16 (any provider that speaks the wire)
