---
id: architecture-overview
type: document
summary: Orbit is a single Node service with a fetcher, a cache and an HTTP layer; decisions live in decisions/.
updated: 2026-06-02T11:00:00Z
---

# Architecture

Orbit has three parts:

- **Fetcher.** Polls the upstream provider hourly and writes normalised forecasts to the cache.
- **Cache.** A flat directory of JSON files, one per location, replaced atomically.
- **HTTP layer.** Read-only endpoints that serve from the cache and never call upstream inline.

Decisions with lasting consequences are recorded in `decisions/` as ADRs, such as [[ADR-0001]].
