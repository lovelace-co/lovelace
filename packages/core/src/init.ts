import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateWorkflow } from './config.js';
import { serializeWorkflow } from './workflow-config.js';
import { SPEC_VERSION } from './types.js';
import type { Workflow } from './types.js';

export interface InitOptions {
  name: string;
  userName?: string;
  now?: () => Date;
  /**
   * A custom workflow gathered by the init wizard. When omitted, the built-in
   * default workflow is written verbatim. When provided, it is validated and
   * serialised; invalid workflows throw before anything is written.
   */
  workflow?: Workflow;
}

const DEFAULT_WORKFLOW = `types:
  - name: epic
    id_prefix: E
  - name: task
    id_prefix: T
  - name: bug
    id_prefix: T

statuses:
  - name: backlog
  - name: todo
  - name: in_progress
    active: true
  - name: in_review
    active: true
  - name: done
    complete: true
  - name: cancelled
    complete: true

transitions:
  - from: backlog
    to: [todo, cancelled]
  - from: todo
    to: [in_progress, backlog, cancelled]
  - from: in_progress
    to: [in_review, todo, cancelled]
  - from: in_review
    to: [done, in_progress, cancelled]

priorities: [urgent, high, medium, low]

fields:
  - name: title
    type: string
    required: true
  - name: parent
    type: reference
    refers_to: [epic]
  - name: depends_on
    type: list
    item_type: reference
  - name: assignee
    type: reference
    refers_to: [actor]
  - name: priority
    type: enum
    values_from: priorities

on_transition: []
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
type: brief
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

function overviewStub(title: string, summary: string, updated: string): string {
  return `---
id: ${title.toLowerCase()}-overview
type: brief
summary: ${summary}
updated: ${updated}
---

# ${title[0]?.toUpperCase()}${title.slice(1)}

(to be written)
`;
}

/**
 * Scaffolds a fresh .lovelace directory. Refuses to run when one already
 * exists. Returns repo-relative paths of everything created.
 */
export function initProject(root: string, options: InitOptions): string[] {
  const dir = join(root, '.lovelace');
  if (existsSync(dir)) {
    throw new Error('.lovelace already exists in this directory');
  }
  // Validate a custom workflow before writing anything, so a rejected
  // configuration never leaves a half-scaffolded project on disk.
  if (options.workflow) {
    const errors = validateWorkflow(options.workflow, '.lovelace/workflow.yaml').filter(
      (i) => i.severity === 'error',
    );
    if (errors.length > 0) {
      throw new Error(`invalid workflow: ${errors.map((i) => i.message).join('; ')}`);
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
  write('workflow.yaml', options.workflow ? serializeWorkflow(options.workflow) : DEFAULT_WORKFLOW);
  write(
    'actors.yaml',
    `actors:\n  - id: me\n    name: ${options.userName ?? 'Developer'}\n    kind: human\n  - id: claude\n    name: Claude Code\n    kind: agent\n`,
  );
  write(
    'CONTEXT.md',
    `---\nid: context\ntype: brief\nsummary: Root brief for ${options.name}; written at init, replace with a real project summary.\nupdated: ${stamp}\n---\n\n# ${options.name}\n\n(Replace this with a project summary.)\n\n## Reading order\n\n1. This file.\n2. briefs/architecture/OVERVIEW.md\n3. The active ticket, its parent and its dependencies.\n`,
  );
  write(
    'briefs/architecture/OVERVIEW.md',
    overviewStub('architecture', 'How the system is decomposed; decisions live in decisions/.', stamp),
  );
  write(
    'briefs/domain/OVERVIEW.md',
    overviewStub('domain', 'Domain terminology and concepts.', stamp),
  );
  write(
    'briefs/conventions/OVERVIEW.md',
    overviewStub('conventions', 'Code style and commit conventions.', stamp),
  );
  write('briefs/architecture/decisions/.gitkeep', '');
  write('templates/ticket.md', TEMPLATE_TICKET);
  write('templates/adr.md', TEMPLATE_ADR);
  write('templates/session.md', TEMPLATE_SESSION);
  write('tickets/.gitkeep', '');
  write('comments/.gitkeep', '');
  write('sessions/.gitkeep', '');

  const gitignore = join(root, '.gitignore');
  const entries = ['.lovelace/state/', '.lovelace/index/index.json', '.lovelace/index/actions.log'];
  const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const missing = entries.filter((e) => !existing.split('\n').includes(e));
  if (missing.length > 0) {
    const lead = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(gitignore, `${lead}${missing.join('\n')}\n`);
    created.push('.gitignore');
  }

  return created;
}
