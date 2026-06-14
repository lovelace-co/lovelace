import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkflow } from './config.js';
import { collectReferences, validateTicketFields } from './fields.js';
import type { Project, ValidationIssue } from './types.js';
import { SESSION_OUTCOMES } from './types.js';

const ID_RE = /^[A-Z]+-\d{4,}$/;
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMMENT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{4}-[a-z][a-z0-9_-]*\.md$/;

export interface ValidateOptions {
  /** Injectable clock for review_by staleness; defaults to the real time. */
  now?: () => Date;
}

/**
 * Validates a loaded project against the spec and its own workflow.yaml.
 * Returns load issues plus everything found here. Errors block mutations;
 * warnings never do.
 */
export function validateProject(project: Project, options: ValidateOptions = {}): ValidationIssue[] {
  const now = options.now ?? (() => new Date());
  const issues: ValidationIssue[] = [...project.issues];
  const { workflow, manifest } = project;

  const add = (
    severity: 'error' | 'warning',
    file: string,
    rule: string,
    message: string,
    key?: string,
  ) => {
    const issue: ValidationIssue = { severity, file, rule, message };
    const line = key !== undefined ? project.keyLines.get(file)?.get(key) : undefined;
    if (line !== undefined) issue.line = line;
    issues.push(issue);
  };

  issues.push(...validateWorkflow(workflow, '.lovelace/workflow.yaml'));

  const statusNames = new Set(workflow.statuses.map((s) => s.name));
  const typeNames = new Set(workflow.types.map((t) => t.name));
  const actorIds = new Set(project.actors.map((a) => a.id));
  const ticketIds = new Set(project.tickets.map((t) => t.id));
  const briefIds = new Set(project.briefs.map((b) => b.id));
  const ticketsById = new Map(project.tickets.map((t) => [t.id, t]));

  if (project.actors.filter((a) => a.kind === 'human').length !== 1) {
    add('error', '.lovelace/actors.yaml', 'actors/one-human', 'exactly one actor must have kind: human');
  }

  // Duplicate IDs across ID-bearing kinds.
  const seen = new Map<string, string>();
  for (const list of [project.tickets, project.sessions] as const) {
    for (const entity of list) {
      const prev = seen.get(entity.id);
      if (prev) {
        add('error', entity.path, 'ids/duplicate', `duplicate ID "${entity.id}" (also in ${prev})`, 'id');
      } else if (entity.id) {
        seen.set(entity.id, entity.path);
      }
    }
  }
  const seenBriefIds = new Map<string, string>();
  for (const brief of project.briefs) {
    const prev = seenBriefIds.get(brief.id);
    if (prev) {
      add('error', brief.path, 'ids/duplicate', `duplicate brief id "${brief.id}" (also in ${prev})`, 'id');
    } else if (brief.id) {
      seenBriefIds.set(brief.id, brief.path);
    }
  }

  const resolveRef = (targets: string[] | undefined, value: string): boolean => {
    if (!targets || targets.length === 0) {
      return ticketIds.has(value) || briefIds.has(value) || actorIds.has(value);
    }
    return targets.some((target) => {
      if (target === 'actor') return actorIds.has(value);
      if (target === 'brief') return briefIds.has(value);
      const ticket = ticketsById.get(value);
      return ticket !== undefined && ticket.type === target;
    });
  };

  for (const ticket of project.tickets) {
    const file = ticket.path;
    const expectedName = `${ticket.id}.md`;
    if (!ID_RE.test(ticket.id)) {
      add('error', file, 'ids/format', `ticket id "${ticket.id}" does not match the ID convention`, 'id');
    } else if (!file.endsWith(`/${expectedName}`)) {
      add('error', file, 'ids/filename', `id "${ticket.id}" does not match the filename`, 'id');
    }
    if (!typeNames.has(ticket.type)) {
      add('error', file, 'tickets/unknown-type', `unknown ticket type "${ticket.type}"`, 'type');
    }
    if (!statusNames.has(ticket.status)) {
      add('error', file, 'tickets/unknown-status', `unknown status "${ticket.status}"`, 'status');
    }
    for (const key of ['created', 'updated'] as const) {
      if (!DATETIME_RE.test(ticket[key])) {
        add('error', file, 'tickets/datetime', `"${key}" must be an ISO 8601 datetime`, key);
      }
    }
    if (typeNames.has(ticket.type)) {
      issues.push(
        ...validateTicketFields(workflow, ticket.type, ticket.fields, file, project.keyLines.get(file)),
      );
      for (const ref of collectReferences(workflow, ticket.type, ticket.fields)) {
        if (!resolveRef(ref.targets, ref.value)) {
          add(
            'error',
            file,
            'links/broken',
            `field "${ref.field}" references "${ref.value}", which does not resolve`,
            ref.field,
          );
        }
      }
    }
  }

  for (const brief of project.briefs) {
    const file = brief.path;
    if (!brief.id) {
      add('error', file, 'briefs/id', 'briefs need an id slug', 'id');
    } else if (!SLUG_RE.test(brief.id) && !/^ADR-\d{4,}$/.test(brief.id)) {
      add('error', file, 'briefs/id', `brief id "${brief.id}" is not a slug or ADR id`, 'id');
    }
    if (!brief.summary) {
      add('error', file, 'briefs/summary', 'briefs need a one to two sentence summary', 'summary');
    }
    if (brief.review_by !== undefined) {
      if (!DATE_RE.test(brief.review_by)) {
        add('error', file, 'briefs/review-by', 'review_by must be an ISO date', 'review_by');
      } else if (new Date(brief.review_by).getTime() < now().getTime()) {
        add('warning', file, 'briefs/stale', `past its review_by date (${brief.review_by})`, 'review_by');
      }
    }
  }

  // Every directory under briefs/ needs an OVERVIEW.md.
  const briefsDir = join(project.dir, manifest.paths.briefs);
  if (existsSync(briefsDir)) {
    const walk = (dir: string, rel: string, isRoot: boolean) => {
      if (!isRoot && !existsSync(join(dir, 'OVERVIEW.md'))) {
        add('warning', `.lovelace/${rel}`, 'briefs/overview', 'directory has no OVERVIEW.md');
      }
      for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, `${rel}/${entry}`, false);
      }
    };
    walk(briefsDir, manifest.paths.briefs, true);
  }

  for (const session of project.sessions) {
    const file = session.path;
    if (!file.endsWith(`/${session.id}.md`)) {
      add('error', file, 'ids/filename', `id "${session.id}" does not match the filename`, 'id');
    }
    if (!ticketIds.has(session.ticket)) {
      add('error', file, 'links/broken', `session ticket "${session.ticket}" does not exist`, 'ticket');
    }
    if (!actorIds.has(session.actor)) {
      add('error', file, 'links/broken', `session actor "${session.actor}" is not in actors.yaml`, 'actor');
    }
    if (!(SESSION_OUTCOMES as readonly string[]).includes(session.outcome)) {
      add('error', file, 'sessions/outcome', `outcome must be one of: ${SESSION_OUTCOMES.join(', ')}`, 'outcome');
    }
    for (const sha of session.commits) {
      if (!SHA_RE.test(sha)) {
        add('error', file, 'sessions/commits', `"${sha}" is not a Git SHA`, 'commits');
      }
    }
    for (const heading of ['Approach', 'What happened', 'Open questions']) {
      if (!new RegExp(`^## ${heading}\\s*$`, 'm').test(session.body)) {
        add('error', file, 'sessions/sections', `body is missing the "## ${heading}" section`);
      }
    }
  }

  for (const comment of project.comments) {
    const file = comment.path;
    const parts = file.split('/');
    const dirTicket = parts[parts.length - 2] ?? '';
    const filename = parts[parts.length - 1] ?? '';
    if (!ticketIds.has(comment.ticket)) {
      add('error', file, 'links/broken', `comment ticket "${comment.ticket}" does not exist`, 'ticket');
    }
    if (comment.ticket && dirTicket !== comment.ticket) {
      add('error', file, 'comments/directory', `comment sits under ${dirTicket}/ but declares ticket ${comment.ticket}`, 'ticket');
    }
    if (!actorIds.has(comment.actor)) {
      add('error', file, 'links/broken', `comment actor "${comment.actor}" is not in actors.yaml`, 'actor');
    }
    if (!COMMENT_NAME_RE.test(filename)) {
      add('warning', file, 'comments/filename', 'filename does not follow <timestamp>-<actor>.md');
    }
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Renders issues as stable, human-readable lines: file:line severity message. */
export function formatIssues(issues: ValidationIssue[]): string {
  return [...issues]
    .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
    .map((i) => `${i.file}${i.line !== undefined ? `:${i.line}` : ''} ${i.severity} [${i.rule}] ${i.message}`)
    .join('\n');
}
