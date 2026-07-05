# Lovelace: Project Brief

This document supersedes BRIEF-PHASES-1-4.md and BRIEF-PHASES-5-6.md. It is the single source of truth for what we are building and in what order.

## What we are building

Lovelace is a local-first project management tool for software development teams that rely heavily on AI coding agents. What Obsidian is to Notion, Lovelace is to Jira and Linear: a desktop application for macOS, Linux and Windows that works entirely on local files, with no server, no database and no cloud component.

Project state lives as plain Markdown files with YAML frontmatter inside a `.lovelace/` directory in the user's repository. The files are the source of truth; everything else (indexes, boards, summaries) is derived from them and can be regenerated at any time.

The product thesis: coding agents already live in the filesystem and in Git. Putting tickets, documents, architectural decisions and agent session history where the agents already are gives them full project context natively, with Git providing the audit trail. For v1 Lovelace is a continuity layer more than a coordination layer. A fresh agent session should start meaningfully smarter because it reads the documentation tree, the current ticket and recent session records before touching code.

The product is the desktop app. There is no standalone user-facing CLI in the MVP. The app initialises projects (new or existing), manages tickets, epics and the documentation tree, and installs the agent integration (CLAUDE.md prompt, hooks, MCP server). A small headless helper binary ships with the app so that hooks and the MCP server have something to execute; it is plumbing, not product.

Scope for v1: a solo developer, one repository per project, reading the current checked-out branch. The app supports multiple projects open simultaneously in tabs. Multiplayer, sync, branch switching, web views and multi-repo are out of scope.

## Principles (apply to every phase)

1. Files are the single source of truth. Anything aggregated is regenerated from frontmatter. If the index and the files disagree, the files win.
2. Direct file access must always work. A user or agent editing Markdown by hand is a supported path, never a corruption risk the system cannot recover from. The app and MCP server are the validated, ergonomic interfaces, not gatekeepers. Malformed input produces a clear validation error pointing at file and line, never a crash and never silent repair.
3. One entity per file. Comments and session records are append-only sibling files, never edits to existing bodies.
4. Volatile data lives in frontmatter; stable structure lives in the directory tree. Tickets never move directories when their status or parent changes.
5. The spec is versioned from day one via the manifest. Tooling must check the spec version before parsing and fail clearly on major versions it does not understand.
6. Keep everything proportionate. No feature beyond what these phases describe. When a design decision is ambiguous, choose the simpler option and record it as an ADR in `.lovelace/documentation/architecture/decisions/` once dogfooding begins.

## The `.lovelace/` directory

```
.lovelace/
  manifest.yaml            spec version, project id, project name, paths
  workflow.yaml            ticket types, statuses, transitions, priorities,
                           field definitions, transition automations
  actors.yaml              the user plus named agent identities
  AGENTS.md                agent operating instructions (mutate, move and
                           resolve tickets); installed by the integration
  documentation/           nested knowledge tree; index.md is where an
                           agent starts reading (a convention, not required)
    index.md
    architecture/
      decisions/           ADRs
    domain/
    conventions/
  tickets/                 flat; one file per ticket, e.g. T-0142.md
  comments/
    T-0142/                one timestamped file per comment
  sessions/                one file per agent session, e.g. S-0031.md
  templates/
    ticket.md
    adr.md
    session.md
  state/                   gitignored; active ticket, queued instructions
  index/
    index.json             generated, gitignored
    BOARD.md               generated, committed
    actions.log            generated, gitignored
```

## Custom fields (a core requirement)

Ticket fields must be user-editable. This is achieved through schema-driven field definitions in `workflow.yaml`, not through code changes.

- A small set of core fields is reserved and locked: `id`, `type`, `status`, `updated`, `created`. These are managed by the tooling.
- Standard fields ship as defaults but are defined in `workflow.yaml` like any other field and can be modified or removed: `title`, `parent`, `depends_on`, `assignee`, `priority`.
- Users define additional fields in `workflow.yaml` with: name, type (`string`, `number`, `boolean`, `date`, `enum`, `list`, `reference`), allowed values for enums, whether required, default value, and which ticket types the field applies to.
- The validator, indexer, MCP server and the app's forms all read field definitions at runtime. Unknown frontmatter keys produce a validation warning, not an error, so hand-edited files degrade gracefully.
- `reference` type fields point to other entity IDs and participate in link integrity checks.

Example fragment:

```yaml
fields:
  - name: estimate
    type: number
    applies_to: [task]
  - name: environment
    type: enum
    values: [local, dev, staging, production]
    applies_to: [bug]
    required: true
```

## Design system

This section supersedes every earlier design direction. The reference implementation is `docs/design/lovelace-ui-v4.html` and the system behind it is `docs/design/lovelace-design-system.md`; where this summary and those files disagree, the HTML wins. The app ships both themes: dark is the default, light is a token flip, and the OS preference is respected on first load.

The intent: a calm instrument for developers working alongside AI agents. Three commitments carry it:

1. No borders. Separation comes from tone steps and whitespace, never lines. Regions are `--bg-0` against `--bg-1`; alternating board columns sit on the `--band` weft; cards rest on `--raise`.
2. One electric signal. A single cyan (`--current`, darker in light mode) is reserved for agent activity, selection and focus. It is never a background fill.
3. Heritage as interaction language. Weaving is the continuous: the thread of current slowly circling a live ticket, tonal bands, slow linear motion. Punchcards are the discrete: clicks depress in `steps()` easing and punch a brief hole at the contact point; epic progress renders as literal punch rows, one hole per task, the reading hole ringed in the signal.

The vocabulary:

- Type: Geist with exactly four sizes (28 title / 18 anchors / 14 body / 12 utility); Geist Mono only for code (inline and fenced code, shell commands, file paths, preformatted machine output). IDs, counts, statuses and other utility text are Geist Sans, with tabular figures on anything numeric. No intermediate sizes, nothing bolder than 700.
- Cards: title row plus one meta row, never taller. Status dot top-left aligned to the first line; pills (epic, urgency) left; identifier pushed right, hover-revealed, never wrapping. Done tickets drop the urgency pill and recede to `--slate`.
- Status hues are workflow-derived and reused identically everywhere: pre-work slate, the first working status carries the signal, later working statuses periwinkle, terminals sage.
- Pills are washes with desaturated text, never bordered, never saturated fills. Urgency families (high/med/low) map from the workflow's priorities list by position.
- The sidebar is `--bg-0` with text navigation, epic punch rows, and the agent status block (sans key/value metadata; `weaving · 4m` in the signal while presence is awake). The presence engine remains file-watcher-driven, as specified in earlier iterations, and now renders as the thread and this block.
- Motion: continuous states are slow and linear (the 7s orbit); state changes are stepped and under 450ms; everything else is a 120-180ms ease on background/colour/opacity. `prefers-reduced-motion` collapses all of it.
- Accessibility floor: AA body text in both themes, visible `--current` focus outlines everywhere, status never colour-alone.

Rules:

1. The attention test: any new element that demands attention the user didn't ask for gets removed or quieted. Resist borders, second meta lines, decorative uses of the signal, new font sizes, faster threads, smoother punches.
2. Everything resolves through CSS custom property tokens in one tokens file; components never reference raw hex values. Light mode exists because of this.
3. Status columns, hues, pills, punch rows, field forms and filters remain workflow.yaml-driven; the design system never hard-codes a field, status or priority.
4. The logo assets are vendored in `apps/desktop`; the wordmark on the welcome screen follows the active theme.

## Phase 1: The spec

Deliverables:

1. `SPEC.md`: a complete written specification of the format, written as if public documentation. It covers the directory layout, the manifest schema, the workflow and field definition schema, frontmatter schemas for tickets, documents, sessions and comments, ID conventions (`T-` tickets, `E-` epics, `S-` sessions, `ADR-` decisions, zero-padded sequential), the index.md convention for the documentation tree, and spec versioning rules (semver; tooling refuses major versions it does not know).
2. The templates in `templates/`.
3. A complete hand-made example project under `examples/demo-project/.lovelace/` exercising every entity type, including at least one custom field. This becomes the fixture for tests in later phases.

Frontmatter baselines:

- Ticket: core fields plus defined fields as above.
- Document: `id`, `type: document`, `summary` (one to two sentences; this is what indexes display), `updated`, `review_by` (optional date after which the file should be flagged stale).
- Session: `id`, `ticket`, `actor`, `started`, `ended`, `commits` (list of SHAs), `outcome` (`completed`, `partial`, `abandoned`). Body sections: Approach, What happened, Open questions.
- Comment filename convention: ISO timestamp plus actor id.

Acceptance: a developer who has never seen this project can create a valid `.lovelace/` directory by hand using only SPEC.md.

## Phase 2: The core engine

A TypeScript package, `packages/core`, containing all parsing, validation and indexing logic. Pure logic with no UI surface and no process-level IO assumptions; the app, the MCP server and the agent helper all call into it. Recommended: gray-matter for frontmatter, zod for schema validation derived at runtime from workflow.yaml, chokidar for the watching layer.

Capabilities:

- Parse and validate every entity: frontmatter against schemas including custom field definitions, link integrity (parents, depends_on and reference fields resolve to existing IDs), status values and ticket types against workflow.yaml, documents past `review_by` flagged stale. Errors carry file and line. Errors and warnings are distinct; warnings never block.
- Index generation: `index/index.json` (all entities with their frontmatter, plus per-file `summary` so consumers never need to parse bodies) and `index/BOARD.md` (tickets grouped by status, readable on GitHub). Output is deterministic: running the indexer twice on unchanged input produces byte-identical output. Sort everything; never emit timestamps into index.json.
- Digest generation: a compact orientation summary for agent session starts. In-progress tickets with titles and summaries, the last three session records (ticket, outcome, open questions), and any validation warnings. Plain text designed to be injected into an agent's context, under roughly 1,500 tokens.
- Mutations: create ticket, update ticket, transition ticket (validated against legal transitions in workflow.yaml), write session record, write comment. ID assignment is atomic via a counter file with an exclusive lock, safe against concurrent writers.
- A watch layer that re-validates and re-indexes on change, debounced.

Acceptance: vitest tests cover every schema and validation rule against the Phase 1 example project plus deliberately corrupted variants of it. Corrupting a fixture file in every plausible way produces a useful validation error, never a crash. The index is byte-stable when run twice on unchanged input.

## Phase 3: The desktop app foundation

A Tauri application (Rust shell, TypeScript and React frontend) in `apps/desktop`. The app reads and writes through `packages/core`, never through a private store. Closing the app loses nothing; everything it knows is in the files.

### Projects and tabs

- The app manages a list of known projects. Multiple projects can be open simultaneously, one per tab.
- Opening a directory without `.lovelace/` offers to initialise it.

### Initialisation (the app's front door)

An init flow that works for both a brand-new project (create a directory, then `.lovelace/` inside it) and an existing repository (drop `.lovelace/` into the project root). It scaffolds the manifest, default workflow.yaml, default actors.yaml, CONTEXT.md stub, templates and directory tree, and adds the gitignored paths (`index/index.json`, `state/`, `actions.log`) to `.gitignore`. Agent integration setup is part of this flow but its deliverables are specified in Phase 4; in this phase the wizard scaffolds files only.

### Views

1. **Board.** Tickets grouped by status, columns from workflow.yaml. Drag between columns performs a validated transition (illegal transitions are not droppable). Filter by type, assignee and any defined custom field.
2. **Ticket detail.** All fields rendered from the field definitions in workflow.yaml: the form is generated from the schema, not hard-coded, so user-defined fields appear automatically with appropriate inputs per type (enum becomes a select, date a date picker, reference an entity picker, list a tag input). Locked core fields are visible but not editable. Bodies render as Markdown; editing in this phase is plain Markdown text (the WYSIWYG editor arrives in Phase 5).
3. **Documentation tree.** The `documentation/` hierarchy as a navigable tree, `index.md` surfaced as a directory's landing page, `review_by`-stale files badged. This view is for the project's documentation (description, architecture, domain, conventions, ADRs), not a general file manager for the user's repository.
4. **Digest panel.** Mirrors the core digest so the app opens oriented, the same as an agent session does.

### Behaviours

- The app runs the watch layer: external edits (an agent writing while the user reads) re-validate, re-index and surface a reload banner on open files. Last write wins; no merging.
- All mutations route through core validation; the app can never produce a file that the validator rejects. Validation errors and warnings are surfaced in the UI with file and line.
- The app implements the design system section of this brief from its first screen; views are not built grey and reskinned later.
- TypeScript strict, vitest, deterministic rendering from index.json fixtures for component tests.
- Produces installable development builds for macOS, Linux and Windows (signing and auto-update arrive in Phase 7).

Acceptance: a user can initialise a project, create and transition tickets on the board, edit ticket fields through the generated form, browse and edit documents, and see external file edits reflected live, all without the files ever diverging from what the app shows.

## Phase 4: Agent integration

This phase delivers the MCP server, the bundled agent helper, and the Claude Code assets the init flow installs. Claude Code is the only agent integration in v1.

### The agent helper

The user does not need Node installed. The MCP server and a small headless helper are bundled with the app as self-contained sidecar executables (evaluate Node single-executable builds and Bun; record the choice as an ADR). The init flow writes hook and MCP configurations that reference these binaries by absolute path under an app-managed location (for example `~/.lovelace/bin/`). The helper exposes exactly what the hooks need: print the digest, check whether a session record was written for the active ticket, and guard writes. It is not a documented user-facing CLI.

### The MCP server

Registered via a project-scoped `.mcp.json` written by the init flow. Official TypeScript MCP SDK, stdio transport. Exposes `packages/core`.

Tools (seven, no more):

1. `create_ticket(type, fields)`: validates fields against workflow.yaml definitions, assigns ID, writes file, returns the ticket.
2. `update_ticket(id, fields)`: status changes are validated as legal transitions per workflow.yaml; rejects edits to locked core fields.
3. `query_tickets(filters)`: filter by status, type, assignee, parent, or any defined custom field; returns frontmatter plus summary, not bodies, unless `include_body` is set.
4. `read_document(id_or_path)`: returns a document's body; given a directory, returns its index.md plus the summaries of children.
5. `log_session(ticket, approach, outcome, commits, open_questions)`: writes a session record file.
6. `search(query)`: plain text search across entity bodies and titles; simple substring or basic ranking is sufficient, no embeddings.
7. `set_active_ticket(id)`: records the ticket the session is working on in `.lovelace/state` (null clears it). Validates the ticket exists. The pointer feeds the commit message Git hook, the digest and the session-record check; the file itself remains hand-editable state, not project truth.

Every mutation triggers a re-index. Tool descriptions must be written for agent consumption: state when to use each tool and what it returns.

### Claude Code assets, installed by the init flow

1. A CLAUDE.md section that is a pure pointer, not a manual: it imports and tells the agent to follow `.lovelace/AGENTS.md`. The direction itself lives in `.lovelace/AGENTS.md`, a Lovelace-owned, regenerated file: read CONTEXT.md before any work; when working a ticket, read the ticket, its parent, its dependencies and the last two sessions referencing it; mutate tickets only through the Lovelace MCP tools; include the active ticket ID in every commit message; resolve a ticket by moving it with update_ticket to a status the workflow legally allows out of its current one (the session-start digest lists them), never an invented status, and follow any per-transition direction the project's automations or CONTEXT.md give; write a session record before finishing. If the project already has a CLAUDE.md, append a clearly delimited Lovelace section rather than overwriting; the same delimiters keep AGENTS.md regenerable. The app offers to write these automatically, with a copy-paste fallback shown if the user declines or the write is unsafe.
2. Hooks in `.claude/settings.json`:
   - `SessionStart`: runs the helper's digest and injects the output.
   - `Stop`: checks whether a session record was written for the active ticket and, if not, emits a prompt instructing the agent to write one before finishing.
   - `PreToolUse`: blocks `Edit` and `Write` calls targeting `.lovelace/tickets/`, with a message directing the agent to the MCP tools. Documents remain directly editable.
3. Slash commands in `.claude/commands/`:
   - `/ticket <id>`: loads the ticket, linked documents and recent sessions into context, sets it as the active ticket via `set_active_ticket`, and transitions it to in progress.
   - `/done`: replays the ticket's acceptance criteria back to the agent for self-check, transitions the ticket, and writes the session record.
4. A `prepare-commit-msg` Git hook that injects the active ticket ID from `.lovelace/state` into commit messages when not already present. Installed opt-in by the init flow.

Anything the app cannot safely do automatically (for example, settings the user has locked down) is presented as clear manual instructions instead.

Acceptance: on a machine with only the app installed (no Node), a freshly initialised project gives a Claude Code session that starts oriented (digest visible), works a ticket end to end via slash commands and MCP tools, produces commits carrying the ticket ID, and leaves behind a valid session record, while the user watches the same ticket move across the board in the app. Dogfooding then begins: this repository itself adopts `.lovelace/` and all subsequent development is tracked in it.

## Phase 5: WYSIWYG editing and history

### The WYSIWYG editor (core requirement)

Documents and ticket bodies are edited in a WYSIWYG editor that compiles to Markdown conforming to the spec. Recommended foundation: Milkdown or Tiptap with a Markdown serialiser; evaluate both for round-trip fidelity before committing.

Requirements:

1. **Round-trip fidelity is the acceptance bar.** Opening a Markdown file and saving without edits must produce a byte-identical file. Edits must produce minimal diffs touching only changed blocks. No reflowing, no list-marker normalisation, no escaping churn. This protects Git history and hand-editability, which are product principles, not conveniences. If the chosen editor cannot achieve this, fix the serialiser or change editor; do not relax the bar.
2. Frontmatter is never shown raw in the editor. Document frontmatter (summary, review_by) is edited through a small properties panel; ticket frontmatter is the schema-generated form from the ticket detail view.
3. Supported constructs: headings, paragraphs, bold and italic, links, ordered and unordered lists, task lists, tables, fenced code blocks with language, blockquotes, images by relative path. Anything outside this set encountered in an existing file is preserved verbatim as an uneditable raw block rather than mangled.
4. Creating a new document through the app scaffolds from `templates/`, places the file in the chosen directory, and prompts for the directory if ambiguous. Creating a folder scaffolds a starter `index.md` so it is discoverable.

### History views

1. **Sessions.** Reverse-chronological session records with their tickets, outcomes, commits and open questions.
2. **Ticket timeline.** Linked comments, session records and commits (resolved via the ticket IDs in commit messages) display in a timeline on the ticket detail view.

Acceptance: a fortnight of dogfooding in which the developer manages this repository's own tickets and documents entirely through the app, while Claude Code sessions run concurrently against the same files, with no corruption, no noisy diffs and no divergence between what the app shows and what the files contain.

## Phase 6: Transition automation

Status transitions can trigger actions, defined declaratively in `workflow.yaml`. The point is to let users encode custom processes around their workflow, including processes the agent carries out. Example: when a ticket moves from In Review to Staging, the user's rule instructs the agent to deploy.

Schema:

```yaml
on_transition:
  - when: { to: staging, type: task }
    agent: Deploy the current branch to staging using scripts/deploy-staging.sh
           and report the result in a comment on the ticket.
  - when: { to: done }
    run: ./scripts/archive-artifacts.sh
```

Requirements:

1. `when` matches on `to`, optionally `from`, ticket `type`, and any defined field value.
2. Two action kinds:
   - `run`: a shell command executed from the repo root with the ticket's frontmatter exposed as `LOVELACE_*` environment variables (`LOVELACE_ID`, `LOVELACE_TITLE`, and so on). Executed by the app's watch layer when it observes the transition.
   - `agent`: an instruction for Claude Code. When the transition is initiated by the agent (via `update_ticket` or `/done`), the instruction is returned in the tool response so the agent acts on it in the same session. When the transition is initiated by the user in the app, the instruction is queued in `.lovelace/state` and delivered at the next session start through the digest hook.
3. Lovelace is an orchestrator, not a CI system. Actions trigger existing scripts and pipelines. Do not build retries, queues, scheduling or log management beyond writing each action's output to `.lovelace/index/actions.log`.
4. Every fired action is recorded in `.lovelace/index/actions.log` with a timestamp, the ticket and the move (and for `run` actions the command and exit code), so each automation run is traceable in the app. Actor attribution comes from the mutation source: MCP mutations carry the agent actor, app mutations carry the human actor from actors.yaml, which is what decides whether an `agent` instruction is returned inline or queued.
5. Failed actions never roll back the transition. The transition is fact; the action result is reported (exit code and log tail) in the app and in the digest.
6. A dry-run mode in the app: select a ticket and a target status and see which actions would fire, without executing them.
7. The validator flags `on_transition` rules referencing unknown statuses, types or fields.

### Activity view

The automation run history from actions.log, plus a dry-run probe of which actions a move would fire without executing them.

Acceptance: a deployable ticket moved to staging by an agent runs its rule (or hands the agent the instruction inline); the run history is inspectable in the app; the validator catches rules referencing unknown statuses, types or fields.

## Phase 7: Distribution

- Signed installers for macOS (notarised), Windows (code signed) and Linux.
- Auto-update via the Tauri updater, serving update manifests from our website.
- Downloads hosted on the Lovelace website.
- No telemetry.

Acceptance: a user can download the app from the website, install it without security warnings, and receive an update automatically when one ships.

## Repository structure

Monorepo, pnpm workspaces, Node 22 for development, TypeScript strict mode:

```
apps/
  desktop/     the Tauri app (Rust shell, React frontend)
packages/
  core/        parsing, schemas, validation, indexing (no UI or IO surface)
  mcp/         the MCP server and the headless agent helper
examples/
  demo-project/
SPEC.md
CLAUDE.md
BRIEF.md
```

## Out of scope for v1

A standalone user-facing CLI, multiplayer and sync, permissions, branch and ref switching, web and mobile views, multi-repo projects, notifications, time tracking, embeddings or semantic search, agent integrations other than Claude Code, transition retries and scheduling, any cloud component beyond hosting downloads and update manifests.
