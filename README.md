# FlowOps Lite

**A lightweight operations dashboard built with Angular, NestJS, PostgreSQL and TypeScript.**

> **Project status:** early portfolio demo (`v0.1`). This is a self-authored learning and portfolio project, **not** a commercial customer deployment. Screens and data are synthetic. Authentication, multi-tenancy and production deployment are not implemented yet.

## What it does

- List tasks loaded from a real PostgreSQL database through the NestJS REST API.
- Filter by task title, team, status and priority.
- Create new tasks with both client-side and server-side validation.
- Update task statuses (`To do`, `In progress`, `Done`) and persist changes.
- Show summary KPIs derived from live task data.
- Load initial example data automatically into a fresh local database.

### Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20, standalone components, signals, reactive API state, CSS |
| Backend | NestJS 11, TypeScript, parameterized SQL with `pg` |
| Database | PostgreSQL 16 via Docker Compose |
| Quality | Node.js test runner via `tsx`, GitHub Actions build workflow |

## Architecture

```mermaid
flowchart TD
    A[Angular SPA] -->|HTTP /api/tasks| B[NestJS REST API]
    B --> C[Input validation]
    C --> D[Task repository]
    D --> E[(PostgreSQL)]
```

The frontend development server proxies `/api` requests to the backend. Frontend and backend share the same domain concepts (task, priority, status), but their code is intentionally kept separate for clarity.

## Run locally (Windows / macOS / Linux)

Requirements: Node.js 22 LTS (or >=20.19), npm, Docker Desktop (or Docker Engine). A working internet connection is required for the initial `npm install`.

Run from the **repository root**:

```bash
npm install
docker compose up -d
```

Create a local `.env` from `.env.example`, then open **two terminals**:

**Terminal A — API**
```bash
npm run dev:api
```

**Terminal B — Angular SPA**
```bash
npm run dev:web
```

Open **http://localhost:4200**. The frontend will use the API at `/api/tasks` through its dev proxy. Check **http://localhost:3000/api/health** to verify the API. Docker's default local DB credentials are explicitly **development-only**.

> On Windows PowerShell, to create `.env`: `Copy-Item .env.example .env`. A `.env` file is optional for the default local DB settings, but useful for later configuration. `docker compose up -d` needs Docker Desktop running.

### Run checks

```bash
npm run test
npm run build
```

The tests cover task validation. The build commands compile both applications. There are no browser E2E tests or database integration tests yet: this is an explicit backlog item, not a claim of coverage.

### API endpoints

| HTTP | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Service health |
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Add task (`title`, `team`, `priority`) |
| PATCH | `/api/tasks/:id/status` | Update status (`todo`, `in_progress`, `done`) |

Example API request:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Refine team dashboard","team":"Frontend","priority":"high"}'
```

## Engineering choices and limitations

1. **PostgreSQL rather than a fake frontend-only API.** Persists data across restarts.
2. **Typed DTO validation and parameterized SQL.** Server validates external inputs instead of trusting the UI.
3. **Angular signals.** KPI and filter computations are derived from the latest API data.
4. **Minimal dependencies.** UI uses native HTML controls and custom CSS rather than a large component library.
5. **Explicit scope.** No authentication, RBAC, migration versioning, pagination, concurrency conflict detection, audit logs, or deployment hardening. Do not deploy this repository publicly with write endpoints until those are implemented.

Future improvements are recorded in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## About the portfolio

This is a demonstration of engineering approach, not evidence of a commercial engagement. The author also has professional experience developing enterprise Angular applications, REST APIs and AWS-based solutions, as described separately in the CV and professional project case studies.

---

**License:** MIT (see [LICENSE](LICENSE)).
