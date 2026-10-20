# FlowOps portfolio roadmap

## v0.1 — first public repository (provided)
- [x] Angular dashboard layout with responsive design
- [x] NestJS REST API and PostgreSQL persistence
- [x] Task creation, filtering, status updates
- [x] Sample records and validation tests
- [x] Docker Compose, GitHub Actions example
- [ ] Verify clean installation, frontend build and backend tests on local Windows machine
- [ ] Capture screenshots from a running instance

## v0.2 — Full-stack professionalism
- [x] Database migrations rather than auto-create at startup
- [x] Backend session authentication (cookies, refresh rotation, CSRF, rate limits)
- [x] Angular login, session restore, cookie interceptor
- [x] Backend task authorization and `owner_id` (M2.2-A)
- [x] Angular dashboard guard, CSRF on task writes, role-aware copy (M2.2-B)
- [x] M2.3 security QA: targeted hardening (refresh Web Locks, `Cache-Control: no-store`, extra negative tests). Cross-tab without Web Locks and MEMBER browser still documented limitations.
- [x] M2.3-F: production cookie fail-closed boot, isolated MEMBER/browser QA harness (`flowops_test_m23f`, localhost:4310). GitHub CI on the feature branch remains a push-time check.
- [x] API integration tests with a test database (`flowops_test`)
- [x] Angular service tests (paged API, search debounce, error/reload)
- [x] Frontend loading/empty/error state improvements
- [x] Pagination, filtering, search and sorting on backend (`GET /api/tasks`)
- [x] Wire Angular list/KPIs to the paged tasks API
- [ ] Accessible, confirmed task status changes
- [ ] Production deployment with secrets and backups

## v0.3 — React track
- [ ] Build a customer-facing React / TypeScript workspace
- [ ] Use the same REST API but create distinct user flows
- [ ] React Hook Form and TanStack Query with mutations and error handling
- [ ] Component and E2E tests

## FlowOps AI — M3 task domain and intelligence

- [x] **M3.1-A** Task domain extensions (backend/database): migration `005_extend_task_details.sql` (`description`, `due_at`, `completed_at`); UTC calendar due dates; server-owned `completedAt`; `isOverdue`; `PATCH /api/tasks/:id`; `GET /api/tasks/summary` (authorized scope, not the current page).
- [x] **M3.1-B** Angular task details, edit, due dates, overdue display, create optional fields, and summary KPIs. No AI.
- [x] **M3.1-C** Final integration and isolated browser QA (`flowops_test_m31c`, `127.0.0.1:4310`). MEMBER isolation, ADMIN cross-user, due dates/completion, summary KPIs, responsive 375/768/1280. No AI.
- [ ] **M3.2** AI infrastructure
- [ ] **M3.3** AI requirements → tasks
- [ ] **M3.4** AI project intelligence
- [ ] **M3.5** Portfolio release

## v0.4 — AI engineering track
- [ ] Add a server-side LLM gateway with an explicitly configured provider
- [ ] Structured extraction from task descriptions
- [ ] Tool calling with approval before write actions
- [ ] Optional document search / RAG via pgvector
- [ ] Eval set with grounded, repeatable test cases
- [ ] Tracing, usage/cost tracking, prompt injection guardrails

**Important:** AI-assisted development (using Claude Code/Codex to write code) is not the same as shipping an AI-powered application. The AI track is not complete until the software actually runs and passes basic evaluations.
