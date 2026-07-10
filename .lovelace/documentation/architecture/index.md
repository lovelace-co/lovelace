---
id: architecture-overview
type: document
summary: A pnpm monorepo; pure core logic, sidecar processes for agents and the app shell, and a Tauri desktop frontend.
updated: 2026-06-10T12:00:00Z
---

# Architecture

Four parts, one direction of dependency:

- **packages/core.** Parsing, schemas, validation, indexing, digest, mutations. Pure TypeScript with no UI surface; everything else calls into it.
- **packages/mcp.** The agent-facing processes: the MCP server (seven tools), the headless agent helper that Claude Code hooks invoke, and the core host the desktop app spawns per request. All three compile to self-contained sidecar binaries with Bun (see ADR-0001).
- **apps/desktop.** The Tauri app: Rust shell (process spawning, file watching) and a React frontend that renders entirely from core snapshots. The app holds no private store.
- **examples/demo-project.** The canonical fixture every test suite runs against.

Decisions with lasting consequences are recorded in `decisions/`.
