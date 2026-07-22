<!-- lovelace:start -->
# Working in this project with Lovelace

This project's tickets, documentation and session history live in `.lovelace/` and are managed with Lovelace. Lovelace owns and regenerates this file; put project specifics in `.lovelace/documentation/index.md`, not here.

## Before you start
- Read `.lovelace/documentation/index.md` for the project summary and reading order.
- When working a ticket, read the ticket, its parent, its dependencies, and the last two session records referencing it.

## Where files live
- Tickets live only in `.lovelace/tickets/`, created and changed only through the Lovelace MCP tools.
- Project documentation lives only under `.lovelace/documentation/`. Write every plan, decision record, guide or other project document there. Never write project documentation to a `docs/` folder at the repository root or anywhere else in the application tree; files outside `.lovelace/documentation/` are not validated or indexed and stay invisible to the project.

## Working with tickets
- Mutate tickets only through the Lovelace MCP tools (create_ticket, update_ticket); never edit files in `.lovelace/tickets/` directly. Documents under `.lovelace/documentation/` may be edited directly.
- Every document must start with a YAML frontmatter block between `---` lines carrying `id` (a unique kebab-case slug), `type: document` and `summary` (one or two sentences). A file without this block fails validation and stays out of the project's documentation.
- Include the active ticket ID in every commit message.

## Resolving a ticket
When you finish or pause work, move the ticket with update_ticket to the status that reflects what happened: the status tagged `agent: in_progress` while you are actively working it, the status tagged `agent: complete` once it is done, or any other status defined in schema.yaml if you are pausing or handing it back. Call describe_schema to see the statuses and their agent roles; any status defined there is a legal move, there is no configured flow gating it. When a move needs explaining (for example you are handing the ticket back because you are blocked), add a comment saying what you need.

## Before you finish
- Write a session record with the log_session tool: approach, what happened, the outcome, commit SHAs, and any open questions.
<!-- lovelace:end -->
