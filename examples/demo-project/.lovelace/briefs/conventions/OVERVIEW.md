---
id: conventions-overview
type: brief
summary: Code style and commit conventions for Orbit.
updated: 2026-04-20T14:00:00Z
review_by: 2026-06-01
---

# Conventions

- TypeScript strict mode, no `any`.
- Conventional commits with the active ticket ID, for example `fix: clamp wind gusts to sane range (T-0004)`.
- Errors to stderr, data to stdout.
- Tests with vitest; every endpoint has an integration test.
