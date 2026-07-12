---
description: Load a Lovelace ticket into context and start working it
---

Work Lovelace ticket $ARGUMENTS:

1. Use the Lovelace query_tickets tool to load the ticket, then read its parent and every ticket in depends_on.
2. Use read_document on .lovelace/documentation/index.md and any documents the ticket references.
3. Use search to find the last two session records referencing this ticket and read their open questions.
4. Call set_active_ticket with the ticket ID.
5. If the ticket is not already in progress, move it with update_ticket to the status tagged `agent: in_progress`.
6. Summarise the ticket, its acceptance criteria and any open questions, then begin.
