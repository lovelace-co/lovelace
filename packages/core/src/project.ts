import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ConfigError, loadActors, loadManifest, loadSchema } from './config.js';
import { FrontmatterError, parseFrontmatter } from './frontmatter.js';
import type {
  Comment,
  Document,
  Project,
  SessionRecord,
  Ticket,
  ValidationIssue,
} from './types.js';
import { CORE_FIELDS } from './types.js';

export class ProjectError extends Error {
  code?: 'spec-too-new' | 'spec-needs-migration';
  declared?: string;
  supported?: string;

  constructor(
    message: string,
    public file: string,
    public line?: number,
    extra?: { code?: 'spec-too-new' | 'spec-needs-migration'; declared?: string; supported?: string },
  ) {
    super(message);
    this.name = 'ProjectError';
    if (extra?.code !== undefined) this.code = extra.code;
    if (extra?.declared !== undefined) this.declared = extra.declared;
    if (extra?.supported !== undefined) this.supported = extra.supported;
  }
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

/**
 * Loads a whole project from disk. Parse failures of individual entities are
 * recorded as issues and the entity is skipped; configuration failures throw
 * ProjectError because nothing can be interpreted without them.
 */
export function loadProject(root: string): Project {
  const dir = join(root, '.lovelace');
  if (!existsSync(dir)) {
    throw new ProjectError('no .lovelace directory found', '.lovelace');
  }
  let manifest, schema, actors;
  try {
    manifest = loadManifest(dir);
    schema = loadSchema(dir);
    actors = loadActors(dir);
  } catch (e) {
    if (e instanceof ConfigError) {
      throw new ProjectError(e.message, e.file, e.line, {
        code: e.code,
        declared: e.declared,
        supported: e.supported,
      });
    }
    throw e;
  }

  const issues: ValidationIssue[] = [];
  const keyLines = new Map<string, Map<string, number>>();
  const rel = (abs: string) => relative(root, abs).split(sep).join('/');

  const readEntity = (abs: string) => {
    const file = rel(abs);
    try {
      const text = readFileSync(abs, 'utf8');
      const parsed = parseFrontmatter(text);
      keyLines.set(file, parsed.keyLines);
      return { file, parsed };
    } catch (e) {
      if (e instanceof FrontmatterError) {
        issues.push({ severity: 'error', file, line: e.line, rule: 'parse', message: e.message });
        return undefined;
      }
      throw e;
    }
  };

  const tickets: Ticket[] = [];
  for (const abs of listMarkdown(join(dir, manifest.paths.tickets))) {
    const r = readEntity(abs);
    if (!r) continue;
    const fm = r.parsed.data;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (!(CORE_FIELDS as readonly string[]).includes(k)) fields[k] = v;
    }
    tickets.push({
      id: str(fm.id),
      type: str(fm.type),
      status: str(fm.status),
      created: str(fm.created),
      updated: str(fm.updated),
      fields,
      body: r.parsed.body,
      path: r.file,
    });
  }

  const documents: Document[] = [];
  const documentFiles = listMarkdown(join(dir, manifest.paths.documentation)).filter((p) => existsSync(p));
  for (const abs of documentFiles) {
    const r = readEntity(abs);
    if (!r) continue;
    const fm = r.parsed.data;
    const { id, type, summary, updated, review_by, ...extra } = fm;
    const document: Document = {
      id: str(id),
      summary: str(summary),
      extra: { type, ...extra },
      body: r.parsed.body,
      path: r.file,
    };
    if (updated !== undefined) document.updated = str(updated);
    if (review_by !== undefined) document.review_by = str(review_by);
    documents.push(document);
  }

  const sessions: SessionRecord[] = [];
  for (const abs of listMarkdown(join(dir, manifest.paths.sessions))) {
    const r = readEntity(abs);
    if (!r) continue;
    const fm = r.parsed.data;
    sessions.push({
      id: str(fm.id),
      ticket: str(fm.ticket),
      actor: str(fm.actor),
      started: str(fm.started),
      ended: str(fm.ended),
      commits: Array.isArray(fm.commits) ? fm.commits.map(str) : [],
      outcome: str(fm.outcome),
      body: r.parsed.body,
      path: r.file,
    });
  }

  const comments: Comment[] = [];
  for (const abs of listMarkdown(join(dir, manifest.paths.comments))) {
    const r = readEntity(abs);
    if (!r) continue;
    const fm = r.parsed.data;
    comments.push({
      ticket: str(fm.ticket),
      actor: str(fm.actor),
      created: str(fm.created),
      body: r.parsed.body,
      path: r.file,
    });
  }

  return {
    root,
    dir,
    manifest,
    schema,
    actors,
    tickets,
    documents,
    sessions,
    comments,
    issues,
    keyLines,
  };
}
