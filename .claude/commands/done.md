---
description: Close out the active Lovelace ticket
---

Finish the active Lovelace ticket:

1. Read .lovelace/state/active_ticket for the active ticket ID; if empty, ask which ticket to close.
2. Re-read the ticket's acceptance criteria and check each one against what you actually did.
3. Move the ticket with update_ticket to the status tagged `agent: complete` if the work is done, or another status defined in schema.yaml that reflects the outcome. If you are handing it back, add a comment explaining what you need.
4. Write the session record with log_session: approach, what happened, outcome, commit SHAs, open questions.
5. Call set_active_ticket with null to clear it.
