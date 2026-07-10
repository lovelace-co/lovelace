<!-- lovelace:start -->
# Working in this project with Lovelace

This project's tickets, documentation and session history live in `.lovelace/` and are managed with Lovelace. Lovelace owns and regenerates this file; put project specifics in `.lovelace/documentation/index.md`, not here.

## Before you start
- Read `.lovelace/documentation/index.md` for the project summary and reading order.
- When working a ticket, read the ticket, its parent, its dependencies, and the last two session records referencing it.

## Working with tickets
- Mutate tickets only through the Lovelace MCP tools (create_ticket, update_ticket); never edit files in `.lovelace/tickets/` directly. Documents under `.lovelace/documentation/` may be edited directly.
- Every document must start with a YAML frontmatter block between `---` lines carrying `id` (a unique kebab-case slug), `type: document` and `summary` (one or two sentences). A file without this block fails validation and stays out of the project's documentation.
- Include the active ticket ID in every commit message.

## Resolving a ticket
When you finish or pause work, move the ticket with update_ticket to the status that reflects what happened. You may only use the transitions the project's workflow allows out of the current status; the session-start digest lists those legal next statuses for each in-progress ticket. Choose from that list, and never invent a status or attempt a move the workflow does not allow. When a move needs explaining (for example you are handing the ticket back because you are blocked), add a comment saying what you need. Follow any direction the project gives for a transition in documentation/index.md or its automations.

## Before you finish
- Write a session record with the log_session tool: approach, what happened, the outcome, commit SHAs, and any open questions.
<!-- lovelace:end -->
