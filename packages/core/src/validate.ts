import { join } from 'node:path';
import { MANIFEST_KNOWN_KEYS, validateSchema } from './config.js';
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
 * Validates a loaded project against the spec and its own schema.yaml.
 * Returns load issues plus everything found here. Errors block mutations;
 * warnings never do.
 */
export function validateProject(project: Project, options: ValidateOptions = {}): ValidationIssue[] {
  const now = options.now ?? (() => new Date());
  const issues: ValidationIssue[] = [...project.issues];
  const { schema } = project;

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

  issues.push(...validateSchema(schema, '.lovelace/schema.yaml'));

  // Same tolerant-reads rule as the schema (ADR-0011): an unrecognised
  // manifest key is a warning naming the key, never an error.
  for (const key of Object.keys(project.manifest).filter((k) => !MANIFEST_KNOWN_KEYS.has(k))) {
    add('warning', '.lovelace/manifest.yaml', 'manifest/unknown-key', `manifest.yaml carries unknown key "${key}"`);
  }

  const statusNames = new Set(schema.statuses.map((s) => s.name));
  const typeNames = new Set(schema.types.map((t) => t.name));
  const actorIds = new Set(project.actors.map((a) => a.id));
  const ticketIds = new Set(project.tickets.map((t) => t.id));
  const documentIds = new Set(project.documents.map((b) => b.id));
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
  const seenDocumentIds = new Map<string, string>();
  for (const document of project.documents) {
    const prev = seenDocumentIds.get(document.id);
    if (prev) {
      add('error', document.path, 'ids/duplicate', `duplicate document id "${document.id}" (also in ${prev})`, 'id');
    } else if (document.id) {
      seenDocumentIds.set(document.id, document.path);
    }
  }

  const resolveRef = (targets: string[] | undefined, value: string): boolean => {
    if (!targets || targets.length === 0) {
      return ticketIds.has(value) || documentIds.has(value) || actorIds.has(value);
    }
    return targets.some((target) => {
      if (target === 'actor') return actorIds.has(value);
      if (target === 'document') return documentIds.has(value);
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
        ...validateTicketFields(schema, ticket.type, ticket.fields, file, project.keyLines.get(file)),
      );
      for (const ref of collectReferences(schema, ticket.type, ticket.fields)) {
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

  for (const document of project.documents) {
    const file = document.path;
    if (!document.id) {
      add('error', file, 'documents/id', 'documents need an id slug', 'id');
    } else if (!SLUG_RE.test(document.id) && !/^ADR-\d{4,}$/.test(document.id)) {
      add('error', file, 'documents/id', `document id "${document.id}" is not a slug or ADR id`, 'id');
    }
    if (!document.summary) {
      add('error', file, 'documents/summary', 'documents need a one to two sentence summary', 'summary');
    }
    if (document.review_by !== undefined) {
      if (!DATE_RE.test(document.review_by)) {
        add('error', file, 'documents/review-by', 'review_by must be an ISO date', 'review_by');
      } else if (new Date(document.review_by).getTime() < now().getTime()) {
        add('warning', file, 'documents/stale', `past its review_by date (${document.review_by})`, 'review_by');
      }
    }
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
