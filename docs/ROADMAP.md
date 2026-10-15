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
- [ ] Database migrations rather than auto-create at startup
- [ ] Authentication and per-user task ownership
- [ ] API integration tests with a test database
- [ ] Angular component and service tests
- [ ] Frontend loading/empty/error state improvements
- [ ] Pagination and sorting on backend
- [ ] Accessible, confirmed task status changes
- [ ] Production deployment with secrets and backups

## v0.3 — React track
- [ ] Build a customer-facing React / TypeScript workspace
- [ ] Use the same REST API but create distinct user flows
- [ ] React Hook Form and TanStack Query with mutations and error handling
- [ ] Component and E2E tests

## v0.4 — AI engineering track
- [ ] Add a server-side LLM gateway with an explicitly configured provider
- [ ] Structured extraction from task descriptions
- [ ] Tool calling with approval before write actions
- [ ] Optional document search / RAG via pgvector
- [ ] Eval set with grounded, repeatable test cases
- [ ] Tracing, usage/cost tracking, prompt injection guardrails

**Important:** AI-assisted development (using Claude Code/Codex to write code) is not the same as shipping an AI-powered application. The AI track is not complete until the software actually runs and passes basic evaluations.
