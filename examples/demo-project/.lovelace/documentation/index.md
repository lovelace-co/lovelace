---
id: context
type: document
summary: Orbit is a small weather forecast API; read this file, then the architecture overview, before any work.
updated: 2026-06-08T09:00:00Z
---

# Orbit Weather Service

Orbit is a demonstration project: a small HTTP API that serves weather forecasts from cached provider data. It exists to exercise every Lovelace entity type.

## Reading order

1. This file.
2. [[architecture-overview]] for how the service is decomposed.
3. [[domain-overview]] for forecast terminology.
4. [[conventions-overview]] for code style.
5. The active ticket, its parent and its dependencies.

## Rules of engagement for agents

- Mutate tickets only through the Lovelace MCP tools, never by editing files in `tickets/`.
- Include the active ticket ID in every commit message.
- Write a session record before finishing.
- Documents may be edited directly; keep `summary` lines accurate.
