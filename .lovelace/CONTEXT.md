---
id: context
type: brief
summary: Lovelace is a local-first project management desktop app; this repository builds it and tracks its own work in .lovelace.
updated: 2026-06-10T12:00:00Z
---

# Lovelace

This repository builds Lovelace itself: a local-first project management desktop app for agent-heavy software development. Read `BRIEF.md` for what we are building and `SPEC.md` for the file format. From Phase 4 onward this repository dogfoods itself: work is tracked as tickets here.

## Reading order

1. This file.
2. `BRIEF.md` at the repo root, then `SPEC.md`.
3. `briefs/architecture/OVERVIEW.md` and the ADRs under `decisions/`.
4. The active ticket, its parent and its dependencies.

## Rules of engagement for agents

How to work tickets (mutate through the MCP tools, move by outcome to a legal status, write a session record) lives in `.lovelace/AGENTS.md`. In addition, in this repository:

- Run `pnpm test` before declaring any task complete.
