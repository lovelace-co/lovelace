import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateSchema } from './config.js';
import { serializeSchema } from './schema-config.js';
import { SPEC_VERSION } from './version.js';
import type { Schema } from './types.js';

export interface InitOptions {
  name: string;
  userName?: string;
  now?: () => Date;
  /**
   * A custom schema gathered by the init wizard. When omitted, the built-in
   * default schema is written verbatim. When provided, it is validated and
   * serialised; invalid schemas throw before anything is written.
   */
  schema?: Schema;
}

const DEFAULT_SCHEMA = `types:
  - name: epic
    id_prefix: E
    fields:
      - name: title
        type: string
        required: true
  - name: task
    id_prefix: T
    fields:
      - name: title
        type: string
        required: true
      - name: assignee
        type: reference
        refers_to: [actor]
      - name: priority
        type: enum
        values_from: priorities
  - name: bug
    id_prefix: T
    fields:
      - name: title
        type: string
        required: true
      - name: assignee
        type: reference
        refers_to: [actor]
      - name: priority
        type: enum
        values_from: priorities

statuses:
  - name: backlog
  - name: todo
    agent: ready
  - name: in_progress
    agent: in_progress
  - name: in_review
  - name: done
    agent: complete
  - name: cancelled

priorities: [urgent, high, medium, low]
`;

const TEMPLATE_TICKET = `---
id: <id>
type: <type>
status: <status>
created: <created>
updated: <updated>
title: <title>
---

## Description

<description>

## Acceptance criteria

- [ ] <criterion>
`;

const TEMPLATE_ADR = `---
id: <id>
type: document
summary: <summary>
updated: <updated>
---

# <id>: <title>

## Status

Proposed

## Context

<context>

## Decision

<decision>

## Consequences

<consequences>
`;

const TEMPLATE_SESSION = `---
id: <id>
ticket: <ticket>
actor: <actor>
started: <started>
ended: <ended>
commits: []
outcome: <outcome>
---

## Approach

<approach>

## What happened

<what-happened>

## Open questions

- <question>
`;

/**
 * Scaffolds a fresh .lovelace directory. Refuses to run when one already
 * exists. Returns repo-relative paths of everything created.
 */
export function initProject(root: string, options: InitOptions): string[] {
  const dir = join(root, '.lovelace');
  if (existsSync(dir)) {
    throw new Error('.lovelace already exists in this directory');
  }
  // Validate a custom schema before writing anything, so a rejected
  // configuration never leaves a half-scaffolded project on disk.
  if (options.schema) {
    const errors = validateSchema(options.schema, '.lovelace/schema.yaml').filter(
      (i) => i.severity === 'error',
    );
    if (errors.length > 0) {
      throw new Error(`invalid schema: ${errors.map((i) => i.message).join('; ')}`);
    }
  }
  const created: string[] = [];
  const now = options.now ? options.now() : new Date();
  const date = now.toISOString().slice(0, 10);
  const stamp = `${now.toISOString().slice(0, 19)}Z`;
  const write = (rel: string, content: string) => {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    created.push(`.lovelace/${rel}`);
  };

  write(
    'manifest.yaml',
    `spec_version: ${SPEC_VERSION}\nproject_id: ${randomBytes(6).toString('hex')}\nname: ${options.name}\ncreated: ${date}\n`,
  );
  write('schema.yaml', options.schema ? serializeSchema(options.schema) : DEFAULT_SCHEMA);
  write(
    'actors.yaml',
    `actors:\n  - id: me\n    name: ${options.userName ?? 'Developer'}\n    kind: human\n  - id: claude\n    name: Claude Code\n    kind: agent\n`,
  );
  write(
    'documentation/index.md',
    `---\nid: index\ntype: document\nsummary: Where a Lovelace agent starts reading; written at init, replace with a real project summary.\nupdated: ${stamp}\n---\n\n# ${options.name}\n\nThis is \`documentation/index.md\`, the first place an agent looks. Replace it with a project summary and a reading order, and add any documents and folders you like alongside it.\n`,
  );
  write('templates/ticket.md', TEMPLATE_TICKET);
  write('templates/adr.md', TEMPLATE_ADR);
  write('templates/session.md', TEMPLATE_SESSION);
  write('tickets/.gitkeep', '');
  write('comments/.gitkeep', '');
  write('sessions/.gitkeep', '');

  const gitignore = join(root, '.gitignore');
  const entries = ['.lovelace/state/', '.lovelace/index/index.json'];
  const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const missing = entries.filter((e) => !existing.split('\n').includes(e));
  if (missing.length > 0) {
    const lead = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(gitignore, `${lead}${missing.join('\n')}\n`);
    created.push('.gitignore');
  }

  return created;
}
