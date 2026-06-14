import type { AutomationRule, Ticket, Workflow } from './types.js';

/**
 * Returns the on_transition rules matching a transition, in definition
 * order. Matching is exact: `to` always, `from` and `type` when present,
 * and any other `when` key against the ticket's defined field values.
 */
export function matchRules(
  workflow: Workflow,
  ticket: Ticket,
  from: string,
  to: string,
): AutomationRule[] {
  return workflow.on_transition.filter((rule) => {
    const { to: ruleTo, from: ruleFrom, type: ruleType, ...rest } = rule.when;
    if (ruleTo !== to) return false;
    if (ruleFrom !== undefined && ruleFrom !== from) return false;
    if (ruleType !== undefined && ruleType !== ticket.type) return false;
    for (const [key, expected] of Object.entries(rest)) {
      if (ticket.fields[key] !== expected) return false;
    }
    return true;
  });
}
