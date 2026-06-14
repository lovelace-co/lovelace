#!/usr/bin/env node
/**
 * The core host: a stateless bridge between the desktop app's Rust shell
 * and packages/core. One JSON request comes in as argv[2] (or on stdin),
 * one JSON response goes to stdout, and the process exits. The app spawns
 * it per operation; file watching lives in the shell, not here.
 */
import {
  addComment,
  buildBoard,
  buildDigest,
  buildIndex,
  createTicket,
  defaultWorkflow,
  deleteTicket,
  fieldCatalogue,
  getActiveTicket,
  initProject,
  loadProject,
  logSession,
  readBoardOrder,
  search,
  setActiveTicket,
  setColumnOrder,
  updateTicket,
  validateProject,
  writeAutomations,
  writeIndex,
  parseFrontmatter,
  MutationError,
  ProjectError,
} from '@lovelace/core';
import type { Workflow } from '@lovelace/core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  readActionLog,
  recordTransitionOutcome,
  testTransition,
} from './actions.js';
import { installClaudeAssets } from './claude.js';

export interface HostRequest {
  op: string;
  root?: string;
  [key: string]: unknown;
}

/**
 * Where the MCP server and agent helper live, derived from how this host
 * is running: compiled sidecars sit next to each other in one directory;
 * in development the built dist files run under node.
 */
function siblingCommands(): { mcp: string; helper: string } {
  const exe = process.execPath;
  if (/lovelace-host(\.exe)?$/.test(exe)) {
    const dir = exe.replace(/lovelace-host(\.exe)?$/, '');
    const suffix = exe.endsWith('.exe') ? '.exe' : '';
    return { mcp: `${dir}lovelace-mcp${suffix}`, helper: `${dir}lovelace-agent${suffix}` };
  }
  const entry = process.argv[1] ?? '';
  const dir = entry.replace(/host\.js$/, '');
  return { mcp: `node ${dir}server.js`, helper: `node ${dir}helper.js` };
}

type Json = Record<string, unknown>;

function snapshot(root: string): Json {
  const project = loadProject(root);
  const issues = validateProject(project);
  writeIndex(project);
  return {
    root,
    manifest: project.manifest,
    workflow: project.workflow,
    actors: project.actors,
    index: buildIndex(project),
    fieldCatalogue: fieldCatalogue(project),
    issues,
    digest: buildDigest(project),
    activeTicket: getActiveTicket(root),
    boardOrder: readBoardOrder(project.dir),
  };
}

export async function handle(request: HostRequest): Promise<Json> {
  const root = String(request.root ?? '');
  switch (request.op) {
    case 'ping':
      return { pong: true };
    case 'detect': {
      return { hasLovelace: existsSync(join(root, '.lovelace')) };
    }
    case 'init': {
      const created = initProject(root, {
        name: String(request.name ?? 'Untitled project'),
        userName: request.userName !== undefined ? String(request.userName) : undefined,
        ...(request.workflow !== undefined ? { workflow: request.workflow as Workflow } : {}),
      });
      return { created, ...snapshot(root) };
    }
    case 'default_workflow':
      return { workflow: defaultWorkflow() };
    case 'snapshot':
      return snapshot(root);
    case 'digest': {
      const project = loadProject(root);
      return { digest: buildDigest(project) };
    }
    case 'validate': {
      const project = loadProject(root);
      return { issues: validateProject(project) };
    }
    case 'board': {
      const project = loadProject(root);
      return { board: buildBoard(project) };
    }
    case 'create_ticket': {
      const ticket = await createTicket(
        root,
        {
          type: String(request.type),
          fields: (request.fields ?? {}) as Record<string, unknown>,
          ...(request.body !== undefined ? { body: String(request.body) } : {}),
          ...(request.status !== undefined ? { status: String(request.status) } : {}),
        },
        { actor: request.actor !== undefined ? String(request.actor) : undefined },
      );
      return { ticket, ...snapshot(root) };
    }
    case 'update_ticket': {
      const actor = request.actor !== undefined ? String(request.actor) : undefined;
      const result = await updateTicket(
        root,
        String(request.id),
        (request.fields ?? {}) as Record<string, unknown>,
        { actor, ...(request.force === true ? { forceTransition: true } : {}) },
      );
      const automation = recordTransitionOutcome(root, result, actor);
      return { ticket: result.ticket, automation, ...snapshot(root) };
    }
    case 'delete_ticket': {
      const deleted = await deleteTicket(root, String(request.id));
      return { deleted, ...snapshot(root) };
    }
    case 'set_column_order': {
      await setColumnOrder(root, String(request.status), (request.ids ?? []) as string[]);
      return snapshot(root);
    }
    case 'test_transition': {
      return { rules: testTransition(root, String(request.id), String(request.to)) };
    }
    case 'set_automations': {
      await writeAutomations(root, request.rules ?? []);
      return snapshot(root);
    }
    case 'action_log': {
      return { log: readActionLog(root) };
    }
    case 'install_claude': {
      const defaults = siblingCommands();
      const result = installClaudeAssets(root, {
        mcpCommand: String(request.mcpCommand ?? defaults.mcp),
        helperCommand: String(request.helperCommand ?? defaults.helper),
        gitHook: request.gitHook === true,
      });
      return { ...result, ...snapshot(root) };
    }
    case 'log_session': {
      const result = await logSession(root, {
        ticket: String(request.ticket),
        actor: String(request.actor),
        approach: String(request.approach ?? ''),
        whatHappened: request.whatHappened !== undefined ? String(request.whatHappened) : undefined,
        outcome: String(request.outcome ?? 'completed'),
        commits: (request.commits ?? []) as string[],
        openQuestions: (request.openQuestions ?? []) as string[],
      });
      return { session: result, ...snapshot(root) };
    }
    case 'add_comment': {
      const result = await addComment(root, {
        ticket: String(request.ticket),
        actor: String(request.actor),
        body: String(request.body ?? ''),
      });
      return { comment: result, ...snapshot(root) };
    }
    case 'read_file': {
      const rel = String(request.path);
      if (!rel.startsWith('.lovelace/') || rel.includes('..')) {
        throw new Error('read_file only serves paths inside .lovelace');
      }
      return { content: readFileSync(join(root, rel), 'utf8') };
    }
    case 'write_brief': {
      const rel = String(request.path);
      const project = loadProject(root);
      const isBrief =
        rel === '.lovelace/CONTEXT.md' ||
        rel.startsWith(`.lovelace/${project.manifest.paths.briefs}/`);
      if (!isBrief || rel.includes('..')) {
        throw new Error('write_brief only writes briefs');
      }
      const abs = join(root, rel);
      const existing = parseFrontmatter(readFileSync(abs, 'utf8'));
      const doc = parseDocument(existing.raw);
      if (request.summary !== undefined) doc.set('summary', String(request.summary));
      if (request.review_by !== undefined) {
        if (request.review_by === null) doc.delete('review_by');
        else doc.set('review_by', String(request.review_by));
      }
      doc.set('updated', `${new Date().toISOString().slice(0, 19)}Z`);
      const body = request.body !== undefined ? String(request.body) : existing.body;
      const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
      writeFileSync(abs, `---\n${fm}---\n${body.startsWith('\n') ? body : `\n${body}`}`);
      return snapshot(root);
    }
    case 'write_ticket_body': {
      const project = loadProject(root);
      const ticket = project.tickets.find((t) => t.id === String(request.id));
      if (!ticket) throw new Error(`ticket "${String(request.id)}" does not exist`);
      const abs = join(root, ticket.path);
      const existing = parseFrontmatter(readFileSync(abs, 'utf8'));
      const doc = parseDocument(existing.raw);
      doc.set('updated', `${new Date().toISOString().slice(0, 19)}Z`);
      const body = String(request.body ?? '');
      const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
      writeFileSync(abs, `---\n${fm}---\n${body.startsWith('\n') ? body : `\n${body}`}`);
      return snapshot(root);
    }
    case 'create_brief': {
      const project = loadProject(root);
      const dirRel = String(request.dir ?? `.lovelace/${project.manifest.paths.briefs}`);
      if (!dirRel.startsWith('.lovelace/') || dirRel.includes('..')) {
        throw new Error('create_brief only writes inside .lovelace');
      }
      const name = String(request.name ?? '').replace(/\.md$/, '');
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
        throw new Error('brief filenames are letters, digits and hyphens');
      }
      const summary = String(request.summary ?? '(to be written)');
      const stamp = `${new Date().toISOString().slice(0, 19)}Z`;
      const dirAbs = join(root, dirRel);
      const created: string[] = [];
      mkdirSync(dirAbs, { recursive: true });
      const slug = name.toLowerCase();
      const file = join(dirAbs, `${name}.md`);
      if (existsSync(file)) throw new Error(`${dirRel}/${name}.md already exists`);
      writeFileSync(
        file,
        `---\nid: ${slug}\ntype: brief\nsummary: ${summary}\nupdated: ${stamp}\n---\n\n# ${name}\n\n(to be written)\n`,
      );
      created.push(`${dirRel}/${name}.md`);
      // A new directory under briefs/ gets its OVERVIEW.md per the spec.
      if (request.createOverview === true && !existsSync(join(dirAbs, 'OVERVIEW.md'))) {
        const dirName = dirRel.split('/').pop() ?? 'overview';
        writeFileSync(
          join(dirAbs, 'OVERVIEW.md'),
          `---\nid: ${dirName.toLowerCase()}-overview\ntype: brief\nsummary: ${summary}\nupdated: ${stamp}\n---\n\n# ${dirName}\n\n(to be written)\n`,
        );
        created.push(`${dirRel}/OVERVIEW.md`);
      }
      return { created, ...snapshot(root) };
    }
    case 'commits_for_ticket': {
      const id = String(request.id);
      try {
        const { execSync } = await import('node:child_process');
        const out = execSync(`git log --all --grep=${JSON.stringify(id)} --pretty=format:%h%x09%s -n 20`, {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const commits = out
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => {
            const [sha = '', ...rest] = l.split('\t');
            return { sha, subject: rest.join('\t') };
          });
        return { commits };
      } catch {
        return { commits: [] };
      }
    }
    case 'set_active_ticket': {
      setActiveTicket(root, request.id === null ? null : String(request.id));
      return { activeTicket: getActiveTicket(root) };
    }
    case 'search': {
      const project = loadProject(root);
      return { hits: search(project, String(request.query ?? '')) };
    }
    default:
      throw new Error(`unknown op "${request.op}"`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const bun = (globalThis as { Bun?: { main?: string } }).Bun;
const isMain =
  process.argv[1]?.endsWith('host.js') ||
  process.argv[1]?.endsWith('lovelace-host') ||
  process.argv[1]?.endsWith('lovelace-host.exe') ||
  (bun?.main !== undefined && bun.main.endsWith('host.ts'));
if (isMain) {
  (async () => {
    try {
      const input = process.argv[2] ?? (await readStdin());
      const request = JSON.parse(input) as HostRequest;
      const data = await handle(request);
      process.stdout.write(JSON.stringify({ ok: true, data }));
    } catch (e) {
      const message =
        e instanceof MutationError || e instanceof ProjectError || e instanceof Error
          ? e.message
          : String(e);
      const kind = e instanceof MutationError ? 'mutation' : e instanceof ProjectError ? 'project' : 'internal';
      process.stdout.write(JSON.stringify({ ok: false, error: { kind, message } }));
      process.exitCode = 1;
    }
  })();
}
