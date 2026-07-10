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
  readGraphLayout,
  readPresence,
  search,
  setActiveTicket,
  setColumnOrder,
  writeGraphLayout,
  updateTicket,
  validateProject,
  writeAutomations,
  writeWorkflow,
  writeManifest,
  writeActors,
  writeIndex,
  parseFrontmatter,
  FrontmatterError,
  MutationError,
  ProjectError,
} from '@lovelace/core';
import type { Workflow, WorkflowEdit } from '@lovelace/core';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  readdirSync,
} from 'node:fs';
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
    agentPresence: readPresence(root),
    boardOrder: readBoardOrder(project.dir),
    graphLayout: readGraphLayout(project.dir, project.manifest.paths.state),
  };
}

/** File extensions previewed as an image, mapped to their MIME type. */
const PREVIEW_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** Directories the non-git file walk always skips. */
const WALK_IGNORE_DIRS = new Set([
  '.git',
  '.lovelace',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  'coverage',
  '.turbo',
  'vendor',
]);

/**
 * A bounded filesystem walk for projects that are not git repositories, so the
 * reference picker still works. Skips heavy/noise directories and any hidden
 * directory (there is no .gitignore to consult), and caps the count so a large
 * tree cannot stall the picker. Returns repo-relative paths, sorted.
 */
function walkFiles(root: string): string[] {
  const MAX = 5000;
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    if (out.length >= MAX) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= MAX) return;
      const relPath = rel ? `${rel}/${name}` : name;
      const abs = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (WALK_IGNORE_DIRS.has(name) || name.startsWith('.')) continue;
        walk(abs, relPath);
      } else if (!relPath.startsWith('.lovelace/')) {
        out.push(relPath);
      }
    }
  };
  walk(root, '');
  return out.sort();
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
    case 'set_graph_layout': {
      writeGraphLayout(root, (request.layout ?? {}) as Record<string, { x: number; y: number }>);
      return snapshot(root);
    }
    case 'test_transition': {
      return { rules: testTransition(root, String(request.id), String(request.to)) };
    }
    case 'set_automations': {
      await writeAutomations(root, request.rules ?? []);
      return snapshot(root);
    }
    case 'write_workflow': {
      await writeWorkflow(root, (request.edit ?? {}) as WorkflowEdit);
      return snapshot(root);
    }
    case 'write_manifest': {
      await writeManifest(root, (request.changes ?? {}) as { name?: string });
      return snapshot(root);
    }
    case 'write_actors': {
      await writeActors(root, request.actors ?? []);
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
    case 'list_files': {
      // Tracked plus untracked-but-not-ignored files, so the reference picker
      // sees the working tree the developer sees. The .lovelace/ metadata is
      // excluded: those entities have first-class ticket/document references.
      // Git respects .gitignore exactly; when the project is not a git repo,
      // fall back to a bounded walk with a default ignore set.
      try {
        const { execSync } = await import('node:child_process');
        const out = execSync('git ls-files --cached --others --exclude-standard', {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 64 * 1024 * 1024,
        });
        const files = out
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('.lovelace/'));
        return { files: [...new Set(files)].sort() };
      } catch {
        return { files: walkFiles(root) };
      }
    }
    case 'read_source_file': {
      // Any repo-relative path (for previewing a referenced file), with a
      // traversal guard. Images and PDFs come back base64-encoded for a rich
      // preview; text comes back as UTF-8; everything else is flagged binary.
      // Size caps keep the preview (and the JSON bridge) sane.
      const rel = String(request.path);
      if (rel.startsWith('/') || rel.includes('..') || rel.includes('\0')) {
        throw new Error('read_source_file: path must be a repo-relative path');
      }
      const abs = join(root, rel);
      if (!existsSync(abs)) return { kind: 'missing' };
      const size = statSync(abs).size;
      const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
      const imageMime = PREVIEW_IMAGE_MIME[ext];
      const MEDIA_MAX = 20 * 1024 * 1024;
      const TEXT_MAX = 512 * 1024;
      if (imageMime) {
        if (size > MEDIA_MAX) return { kind: 'image', size, truncated: true };
        return { kind: 'image', mime: imageMime, base64: readFileSync(abs).toString('base64'), size };
      }
      if (ext === 'pdf') {
        if (size > MEDIA_MAX) return { kind: 'pdf', size, truncated: true };
        return { kind: 'pdf', mime: 'application/pdf', base64: readFileSync(abs).toString('base64'), size };
      }
      if (size > TEXT_MAX) return { kind: 'text', size, truncated: true };
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) return { kind: 'binary', size };
      return { kind: 'text', content: buf.toString('utf8'), size };
    }
    case 'write_document': {
      const rel = String(request.path);
      const project = loadProject(root);
      const isDocument = rel.startsWith(`.lovelace/${project.manifest.paths.documentation}/`);
      if (!isDocument || rel.includes('..')) {
        throw new Error('write_document only writes documentation files');
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
    case 'create_document': {
      const project = loadProject(root);
      const dirRel = String(request.dir ?? `.lovelace/${project.manifest.paths.documentation}`);
      if (!dirRel.startsWith('.lovelace/') || dirRel.includes('..')) {
        throw new Error('create_document only writes inside .lovelace');
      }
      const name = String(request.name ?? '').replace(/\.md$/, '');
      if (name === '' || name.includes('/') || name.includes('..')) {
        throw new Error('document filenames cannot be empty or contain path separators');
      }
      const summary = String(request.summary ?? '(to be written)');
      const stamp = `${new Date().toISOString().slice(0, 19)}Z`;
      const dirAbs = join(root, dirRel);
      mkdirSync(dirAbs, { recursive: true });
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
      const file = join(dirAbs, `${name}.md`);
      if (existsSync(file)) throw new Error(`${dirRel}/${name}.md already exists`);
      writeFileSync(
        file,
        `---\nid: ${slug}\ntype: document\nsummary: ${summary}\nupdated: ${stamp}\n---\n\n# ${name}\n\n(to be written)\n`,
      );
      return { created: [`${dirRel}/${name}.md`], ...snapshot(root) };
    }
    case 'create_folder': {
      const project = loadProject(root);
      const documentsRoot = `.lovelace/${project.manifest.paths.documentation}`;
      const parentRel = String(request.dir ?? documentsRoot);
      if (
        !(parentRel === documentsRoot || parentRel.startsWith(`${documentsRoot}/`)) ||
        parentRel.includes('..')
      ) {
        throw new Error('create_folder only creates folders under the documentation root');
      }
      const name = String(request.name ?? '');
      if (name === '' || name.includes('/') || name.includes('..')) {
        throw new Error('folder names cannot be empty or contain path separators');
      }
      const folderRel = `${parentRel}/${name}`;
      const dirAbs = join(root, folderRel);
      if (existsSync(dirAbs)) throw new Error(`${folderRel} already exists`);
      const summary = String(request.summary ?? '(to be written)');
      const stamp = `${new Date().toISOString().slice(0, 19)}Z`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'index';
      mkdirSync(dirAbs, { recursive: true });
      // A folder needs at least one file to exist and be discoverable, so it gets
      // a starter index.md (its entry point). This is a default, not a requirement.
      writeFileSync(
        join(dirAbs, 'index.md'),
        `---\nid: ${slug}\ntype: document\nsummary: ${summary}\nupdated: ${stamp}\n---\n\n# ${name}\n\n(to be written)\n`,
      );
      return { created: [`${folderRel}/index.md`], ...snapshot(root) };
    }
    case 'rename_document': {
      const rel = String(request.path);
      const project = loadProject(root);
      const documentsPrefix = `.lovelace/${project.manifest.paths.documentation}/`;
      if (!rel.startsWith(documentsPrefix) || rel.includes('..')) {
        throw new Error('rename_document only renames files under the documentation root');
      }
      const oldName = rel.split('/').pop() ?? '';
      const name = String(request.name ?? '').replace(/\.md$/, '');
      if (name === '' || name.includes('/') || name.includes('..')) {
        throw new Error('document filenames cannot be empty or contain path separators');
      }
      const next = `${rel.slice(0, rel.length - oldName.length)}${name}.md`;
      if (next === rel) return snapshot(root);
      if (existsSync(join(root, next))) throw new Error(`${next} already exists`);
      renameSync(join(root, rel), join(root, next));
      return { renamed: next, ...snapshot(root) };
    }
    case 'delete_document': {
      const rel = String(request.path);
      const project = loadProject(root);
      const documentsPrefix = `.lovelace/${project.manifest.paths.documentation}/`;
      if (!rel.startsWith(documentsPrefix) || rel.includes('..') || !rel.endsWith('.md')) {
        throw new Error('delete_document only deletes files under the documentation root');
      }
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`${rel} does not exist`);
      }
      rmSync(abs);
      return { deleted: rel, ...snapshot(root) };
    }
    case 'delete_folder': {
      const rel = String(request.path);
      const project = loadProject(root);
      const documentsPrefix = `.lovelace/${project.manifest.paths.documentation}/`;
      if (!rel.startsWith(documentsPrefix) || rel.includes('..') || rel.endsWith('/')) {
        throw new Error('delete_folder only deletes folders under the documentation root');
      }
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        throw new Error(`${rel} does not exist`);
      }
      rmSync(abs, { recursive: true });
      return { deleted: rel, ...snapshot(root) };
    }
    case 'fix_document': {
      const rel = String(request.path);
      const project = loadProject(root);
      const documentsPrefix = `.lovelace/${project.manifest.paths.documentation}/`;
      if (!rel.startsWith(documentsPrefix) || rel.includes('..') || !rel.endsWith('.md')) {
        throw new Error('fix_document only fixes files under the documentation root');
      }
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`${rel} does not exist`);
      }
      const original = readFileSync(abs, 'utf8');
      try {
        parseFrontmatter(original);
        // Already valid: never rewrite a file that already round-trips.
        return snapshot(root);
      } catch (e) {
        if (!(e instanceof FrontmatterError)) throw e;
      }
      const filename = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/, '');
      const slug = filename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
      const stamp = `${new Date().toISOString().slice(0, 19)}Z`;
      writeFileSync(
        abs,
        `---\nid: ${slug}\ntype: document\nsummary: (to be written)\nupdated: ${stamp}\n---\n\n${original}`,
      );
      return { fixed: rel, ...snapshot(root) };
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
