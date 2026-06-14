---
id: context
type: brief
summary: Orbit is a small weather forecast API; read this file, then the architecture overview, before any work.
updated: 2026-06-08T09:00:00Z
---

# Orbit Weather Service

Orbit is a demonstration project: a small HTTP API that serves weather forecasts from cached provider data. It exists to exercise every Lovelace entity type.

## Reading order

1. This file.
2. `briefs/architecture/OVERVIEW.md` for how the service is decomposed.
3. `briefs/domain/OVERVIEW.md` for forecast terminology.
4. `briefs/conventions/OVERVIEW.md` for code style.
5. The active ticket, its parent and its dependencies.

## Rules of engagement for agents

- Mutate tickets only through the Lovelace MCP tools, never by editing files in `tickets/`.
- Include the active ticket ID in every commit message.
- Write a session record before finishing.
- Briefs may be edited directly; keep `summary` lines accurate.
