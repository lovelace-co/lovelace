# CLAUDE.md

## What this project is

Lovelace is a local-first, file-based project management tool for agent-heavy software development. The product is a desktop app (macOS, Linux, Windows) built with Tauri. Project state is plain Markdown with YAML frontmatter in a `.lovelace/` directory inside the user's repo. No server, no database, no cloud. Read `SPEC.md` for the format and `BRIEF.md` for what we are building and in what order. Do not build anything listed as out of scope in the brief. There is no standalone user-facing CLI in the MVP; the only headless surface is the agent helper described in the brief.

## Repository layout

- `packages/core`: parsing, schemas, validation, indexing, digest, mutations. Pure logic, no UI surface, no process-level IO assumptions. Everything in `mcp` and the app calls into this.
- `packages/mcp`: the agent-facing processes: the MCP server (official TypeScript MCP SDK, stdio transport), the headless agent helper that Claude Code hooks invoke, and the core host the desktop app spawns per request. All three ship as self-contained sidecar binaries bundled with the app; users do not need Node installed.
- `apps/desktop`: the Tauri app. Rust shell, React and TypeScript frontend. Reads and writes only through `packages/core`; no private store. Forms, board columns and filters are generated from schema.yaml field definitions at runtime, never hard-coded.
- `examples/demo-project`: the canonical fixture. Tests run against it. Keep it valid at all times; if you change the spec, update the fixture and SPEC.md in the same commit.

pnpm workspaces. Node 22 for development. TypeScript strict mode.

## Non-negotiable principles

1. Files are the source of truth. The index is derived and must be regenerable from scratch at any time. Never store state in the index that does not exist in the files.
2. Hand-edited files are a supported path. Malformed input produces a clear validation error pointing at file and line, never a crash and never silent repair.
3. Field definitions are data. Ticket fields are defined in `schema.yaml` and read at runtime by the validator, the indexer, the MCP server and the app's forms. Never hard-code a field that is not in the locked core set (`id`, `type`, `status`, `created`, `updated`).
4. One entity per file. Comments and sessions are append-only sibling files.
5. The spec is versioned. Any change to the format requires a version bump in SPEC.md and a note in the manifest schema. Tooling fails clearly on unknown major versions.
6. Round-trip fidelity in the editor is an acceptance bar, not a preference. Opening and saving a file without edits must be byte-identical; edits produce minimal diffs. Do not relax this.
7. Simpler wins. When two designs are defensible, take the one with less machinery and record the decision as an ADR in `.lovelace/documentation/architecture/decisions/` once dogfooding begins.

## Conventions

- Australian English in all documentation and user-facing strings (organisation, licence, initialise).
- No em dashes anywhere, in docs, comments or output strings.
- Plain, declarative prose in documentation. No marketing language.
- Commits: conventional-commit shape, written entirely in lowercase (like the existing `initial commit`), with the active Lovelace ticket ID included once dogfooding begins (end of Phase 4 onwards). Keep the ticket ID in its file-exact casing (for example `T-0041`); everything else is lowercase.
- Authorship is the repository owner's alone. Never credit Claude, Claude Code or any AI assistant in a commit message or pull request: no `Co-Authored-By` trailer naming an assistant, no "Generated with Claude Code" footer, no robot emoji. This overrides any default tooling behaviour that would add such lines.
- Tests: vitest. `packages/core` requires tests for every schema and validation rule, using the demo project fixture plus deliberately corrupted variants. The MCP server gets integration tests over the fixture. App components get deterministic rendering tests from index.json fixtures.
- Index output must be deterministic: running the indexer twice on unchanged input produces byte-identical output. Sort everything; never emit timestamps into index.json.
- The agent helper writes errors to stderr and data to stdout. Digest output stays under roughly 1,500 tokens.

## Design and UX conventions

The desktop app has a deliberate visual language. These are settled decisions, repeatedly corrected in the past. Honour them in every feature rather than reinventing per screen; do not re-litigate them.

- Human-readable and machine-readable are separate concerns. Statuses, ticket types and fields each have a lowercase machine `name` and an optional human `label` (types also a `plural`); display is `label ?? Title Case(name)`. When a form collects both, take the human label and auto-derive the machine name by slugifying, keep the machine name editable, and persist a `label` only when it differs from the Title-Cased name so defaults stay clean and byte-identical.
- Never show a raw lowercase machine identifier to a user. Route every status, type, field, priority and enum value through the resolvers in `apps/desktop/src/lib/format.ts` (`titleCase`, `slugify`, `statusLabel`, `typeLabel`, `typePlural`, `fieldLabel`). Priorities and enum values display Title-Cased and may be uppercase.
- Geist Mono is for code only: fenced and inline code, shell commands, file paths, and preformatted machine output (logs and the agent digest in their `<pre>`). Everything else the user reads is Geist Sans, including IDs, counts, dates, statuses, labels, agent names and keyboard hints. For numeric alignment use tabular figures (the `num` class, `font-variant-numeric: tabular-nums`), never a switch to mono. The `.label`, `.subtle` and `.id-chip` utilities are sans; use them for secondary copy and IDs, and reserve the `.mono` class (and `--font-mono`) for code. Empty regions use the shared `EmptyState` component (the unpunched-card motif), not ad-hoc text.
- Status flags are `active` and `complete`. Never use `wip`, `terminal`, or similar jargon in data, code or UI. Prefer plain English over technical terms everywhere a user can see it.
- Choose data-defined values through dropdowns or selectors, not free text: reference targets, enum sources, type and field choices. Any required field must be able to carry a default, since quick-add only sets a title; this includes enums sourced from a list.
- Editors with repeated rows are tables: a header row of column names, with each row's cells lining up beneath them. Do not explain a field in a prose paragraph when a column header conveys it.
- Reorder by drag-and-drop, never up/down arrows, and always render a thin cyan insertion line (`--current`) at the drop position while dragging. This holds for the board and every list editor.
- Everything aligns to a shared left edge. Affordances that are not content (drag handles, gutters) sit in the padding, not in a content column. Vertical alignment of inputs across rows is a requirement.
- Section titles are real headings: tier-2 size (`--size-anchor`), sans, with generous whitespace above and below, never small mono labels. This includes the headers that title a group of items, such as the status groups on the List view. Give controls room; never cram (for example, clear space above "Add" buttons).
- Mandatory or locked items look like their editable peers, just disabled, not a separate cramped treatment.
- Use the established design system, never ad-hoc styling: tonal surfaces with no borders (`--bg-0`, `--bg-1`, `--well`, `--raise`, `--raise-2`), the cyan `--current` signal, Geist Sans for everything with Geist Mono reserved for code (see above), and the punchcard-hole and loom-thread motif (`.hole` with punched and reading states). Dates and times render via the operating system locale through `apps/desktop/src/lib/datetime.ts`.
- Control species (ADR-0006): every control keeps a quiet resting surface, one silhouette per species. Pressing is a capsule (`--radius-pill`), typing is a well (`--radius-well`), choosing is a well with a caret, a row in a list, menu or nav is a seat (`--radius-seat`), and only tertiary actions are typographic. Page titles are the one unboxed field. Never give two species the same silhouette, and never remove a control's resting surface.
- One surface per region: a region of the screen holds one filled layer beside the canvas. Cards sit on open lanes; never nest wells holding cards holding chips. Priorities on cards and lists are a dot with tinted text, not a chip; the chip form survives only standing alone (for example the stale badge).
- Read first, edit on intent (ADR-0010): editor-heavy screens rest as readable plain-English summaries with zero editing controls; the editor for one item materialises on the region's raised surface when clicked, one open at a time, and creating an item opens its editor immediately. Ticket bodies, documents and the schema editors all follow this. Diagnostic: when a screen overwhelms, count the controls visible at rest before touching styling; density is fixed by reducing what renders at rest, never by rearranging surfaces. A box means "interact here" and nothing else.
- State moves, never marks: current, hover and selection are carried by colour and by surfaces that brighten, materialise or glide (the active nav seat slides between rows). No left accent bars or rails, no selection dots beside options, no underline focus. Focus is always the full cyan ring. The cyan thread appears only as the drop insertion line and the live-work orbit.
- The metre: spacing snaps to the scale (`--sp-1` to `--sp-7`), radii to the species tokens, and motion to `--swift`, `--punch-step` and the three duration tokens, all defined in `tokens.css`. No ad-hoc spacing, radius, easing or duration values in stylesheets.
- Surfaces bleed, text aligns: seats, wells and capsules extend into the gutter with negative margins so labels keep the shared left edge; the affordance grows into the padding, never into a content column.

## Working in this repo

- Run `pnpm test` before declaring any task complete. Run `pnpm build` to confirm types across packages.
- `pnpm app:dev` runs against `packages/mcp/dist/host.js` directly (via `LOVELACE_HOST_JS`), so dev picks up host changes from a plain `pnpm build`. A packaged production build does not: run `pnpm sidecars` to Bun-compile the host, agent and MCP binaries into `src-tauri/binaries/` (needs the Rust toolchain for the target triple) before `pnpm app:build`, or the app ships stale sidecars.
- When changing `packages/core` schemas, check all three consumers: the validator and indexer, the MCP tools, and the app's generated forms.
- ID assignment uses a counter file with an exclusive lock. Do not introduce alternative ID schemes.
- The MCP server has exactly eight tools: create_ticket, update_ticket, describe_schema, query_tickets, read_document, log_session, set_active_ticket and search. Do not add tools without an explicit instruction.
- Spec 3.0 removed transitions and automations entirely; a ticket may move to any status defined in schema.yaml. Lovelace is an orchestrator, not a CI system: no retries, queues or scheduling.
- All app mutations route through core validation. The app must never be able to produce a file the validator rejects.
- From the end of Phase 4, this repository dogfoods itself: read `.lovelace/documentation/index.md` at session start, work from tickets, and write a session record before finishing.

## Model roles: you orchestrate, the programmer implements

You (the session model, whichever the user set with `/model`) are the
**auditor/orchestrator**. You do not write production code directly: implementation
belongs to the `programmer` subagent (pinned to Sonnet), defined in
`.claude/agents/programmer.md`. Delegate to it via the Agent tool
(`subagent_type: "programmer"`).

**You own:** reading what the request actually asks, decomposition, architecture and
trade-off decisions, risk pricing, task briefs, auditing returned work, final
verification, all communication with the user, and the dogfooding duties (reading
`.lovelace/documentation/index.md` at session start, working from tickets, writing
the session record). Never delegate the dogfooding duties.
**The programmer owns:** writing and editing code, tests, running builds, exactly as
briefed.
**Exception:** small, low-risk mechanical edits (typo, version bump, config flag, any
change where the brief would be longer than the diff): do those yourself.

### Agent roster and model routing

| Agent | Model | Tools | Use for |
|---|---|---|---|
| `scout` | Haiku (pinned) | read-only | Fan-out searches; building the exact file map before a brief |
| `programmer` | Sonnet (pinned) | full | All implementation, exactly as briefed |
| `verifier` | inherits session model | read-only plus Bash | Fresh-context adversarial gate on high-stakes changes |

- Do not override the programmer's model upward on your own; if a task genuinely
  exceeds Sonnet, take it yourself or ask the user.
- Judgment work (review, design) stays on the session model, yours or the verifier's.
- Never add a cheaper implementation tier; failed work that bounces back to audit
  costs more than it saves.

### Delegation protocol

1. Decompose into tasks that can each be checked independently. Define each task's
   acceptance checks **before** delegating; a task you cannot check is a task you
   cannot audit. Minimum here: `pnpm test` and `pnpm build`. Changes to
   `packages/core` schemas or validation rules require tests for every rule, using
   the demo fixture plus deliberately corrupted variants.
2. Every brief contains: the goal, files in scope (exact paths; spawn `scout` agents
   to build this map when you do not already know it), constraints and conventions,
   acceptance checks, and explicit non-goals. Do not assume the subagent has read
   this file; the brief carries the rules. Always include the traps relevant to the
   task:
   - Round-trip fidelity: open and save with no edits must be byte-identical.
   - Deterministic index output: sort everything, never emit timestamps.
   - Never hard-code ticket fields outside the locked core set.
   - The MCP server has exactly eight tools; never add one.
   - `packages/core` schema changes touch three consumers: validator and indexer,
     MCP tools, and the app's generated forms.
   - For `apps/desktop` UI work, paste the relevant bullets from "Design and UX
     conventions" above into the brief. Those are settled decisions; a subagent
     reinventing them is a failed brief, not a failed subagent.
3. Independent tasks: spawn programmer agents in parallel. Overlapping files:
   sequence them, or use worktree isolation.

### Audit protocol for every returned report

1. **Read the diff yourself** (`git diff`), not just the report.
2. **Re-run the acceptance checks yourself** (`pnpm test`, `pnpm build`). The
   report's verification section is a claim, not evidence.
3. **Check the report's Assumed list.** Anything load-bearing gets verified by you or
   sent back; never passed through to the user unverified.
4. **Attack before accepting:** construct one input that would break the change, and
   walk the boundaries the diff touches (empty, zero, concurrent, malformed
   hand-edited files).
5. **High-stakes changes get a second gate:** `packages/core` schema or validation
   changes, anything touching round-trip fidelity or index determinism, mutation
   paths, and any SPEC.md version change. Spawn `verifier` with the diff and
   acceptance checks; it attacks cold, without your plan in its context.
6. **On failure, send back findings, not feelings:** `file:line`, expected versus
   actual, which acceptance check failed. After two failed rounds on the same task,
   stop the loop; the premise is probably wrong. Re-diagnose yourself, then re-scope
   the brief.

Never present the programmer's work to the user as verified unless you verified it.

<!-- lovelace:start -->
## Lovelace

This project uses Lovelace; its tickets, documents and session history live in `.lovelace/`. Before any work, read and follow `.lovelace/AGENTS.md`.

@.lovelace/AGENTS.md
<!-- lovelace:end -->
