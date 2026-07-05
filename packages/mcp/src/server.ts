#!/usr/bin/env node
/**
 * The Lovelace MCP server: six tools over packages/core, stdio transport.
 * Tool descriptions are written for agent consumption. Every mutation
 * triggers a re-index through core. Mutations carry the agent actor so
 * automation instructions are delivered inline or queued for next session.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createTicket,
  updateTicket,
  logSession,
  loadProject,
  search,
  extractSection,
  setActiveTicket,
  getActiveTicket,
} from '@lovelace/core';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordTransitionOutcome } from './actions.js';

function agentActor(root: string): string {
  const project = loadProject(root);
  return project.actors.find((a) => a.kind === 'agent')?.id ?? 'claude';
}

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

export function buildServer(root: string): McpServer {
  const server = new McpServer({ name: 'lovelace', version: '0.1.0' });

  server.registerTool(
    'create_ticket',
    {
      title: 'Create a Lovelace ticket',
      description:
        'Create a ticket (task, bug, epic or any type defined in workflow.yaml). Use this instead of writing files in .lovelace/tickets/. Fields are validated against the field definitions in workflow.yaml; core fields (id, status, created, updated) are assigned for you. Returns the created ticket including its ID.',
      inputSchema: {
        type: z.string().describe('A ticket type defined in workflow.yaml, for example "task" or "bug"'),
        fields: z
          .record(z.unknown())
          .describe('Defined field values, for example {"title": "...", "priority": "high"}'),
      },
    },
    async ({ type, fields }) => {
      const ticket = await createTicket(root, { type, fields }, { actor: agentActor(root) });
      return text({ ticket });
    },
  );

  server.registerTool(
    'update_ticket',
    {
      title: 'Update or transition a Lovelace ticket',
      description:
        'Update defined fields on a ticket, or change its status by including "status" in fields. Status changes are validated as legal transitions per workflow.yaml; illegal moves are rejected with the legal targets. Locked core fields cannot be edited. Set a field to null to remove it. The response includes any automation the transition triggered: act on "instructions" entries now, and "executed" entries report shell commands that ran.',
      inputSchema: {
        id: z.string().describe('Ticket ID, for example "T-0042"'),
        fields: z.record(z.unknown()).describe('Field changes; include "status" to transition'),
      },
    },
    async ({ id, fields }) => {
      const actor = agentActor(root);
      const result = await updateTicket(root, id, fields, { actor });
      const outcome = recordTransitionOutcome(root, result, actor);
      return text({ ticket: result.ticket, automation: outcome });
    },
  );

  server.registerTool(
    'query_tickets',
    {
      title: 'Query Lovelace tickets',
      description:
        'List tickets filtered by status, type, assignee, parent, or any defined custom field. Returns frontmatter plus title, not bodies, unless include_body is true. Use this to find work, check dependencies, or see what is in progress.',
      inputSchema: {
        filters: z
          .record(z.unknown())
          .optional()
          .describe('Equality filters on core or defined fields, for example {"status": "in_progress"}'),
        include_body: z.boolean().optional().describe('Also return ticket bodies'),
      },
    },
    async ({ filters, include_body }) => {
      const project = loadProject(root);
      const entries = project.tickets.filter((t) => {
        for (const [key, value] of Object.entries(filters ?? {})) {
          const actual =
            key === 'status' ? t.status : key === 'type' ? t.type : key === 'id' ? t.id : t.fields[key];
          if (actual !== value) return false;
        }
        return true;
      });
      return text({
        tickets: entries.map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          created: t.created,
          updated: t.updated,
          ...t.fields,
          ...(include_body ? { body: t.body } : {}),
        })),
      });
    },
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read a Lovelace document',
      description:
        'Read project knowledge: pass a document id (for example "architecture-overview" or "ADR-0003"), a path relative to the repo root, or a directory under .lovelace/documentation to get its index.md plus the summaries of its children. Read .lovelace/documentation/index.md first in any new session.',
      inputSchema: {
        id_or_path: z.string().describe('Document id, file path, or documentation directory'),
      },
    },
    async ({ id_or_path }) => {
      const project = loadProject(root);
      const byId = project.documents.find((b) => b.id === id_or_path);
      const byPath = project.documents.find((b) => b.path === id_or_path);
      const document = byId ?? byPath;
      if (document) {
        return text({ id: document.id, path: document.path, summary: document.summary, body: document.body });
      }
      const dir = id_or_path.replace(/\/$/, '');
      const abs = join(root, dir);
      if (existsSync(abs) && statSync(abs).isDirectory()) {
        // Prefer index.md as the directory's entry point, but degrade gracefully:
        // a folder without one still lists its children rather than erroring.
        const index = project.documents.find((b) => b.path === `${dir}/index.md`);
        const children = project.documents
          .filter((b) => b.path.startsWith(`${dir}/`) && b.path !== `${dir}/index.md`)
          .map((b) => ({ path: b.path, id: b.id, summary: b.summary }));
        const subdirs = readdirSync(abs, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `${dir}/${e.name}`);
        return text({ index: index?.body ?? '', children, subdirectories: subdirs });
      }
      throw new Error(`no document found for "${id_or_path}"`);
    },
  );

  server.registerTool(
    'log_session',
    {
      title: 'Write a Lovelace session record',
      description:
        'Write the session record before finishing work on a ticket: what you set out to do, what happened, the outcome (completed, partial or abandoned), commit SHAs you produced, and any open questions for the next session. This is how the next agent session starts oriented; never skip it.',
      inputSchema: {
        ticket: z.string().describe('The ticket this session worked on'),
        approach: z.string().describe('What you set out to do and how'),
        what_happened: z.string().optional().describe('What actually happened'),
        outcome: z.enum(['completed', 'partial', 'abandoned']),
        commits: z.array(z.string()).optional().describe('Commit SHAs produced this session'),
        open_questions: z.array(z.string()).optional().describe('Unresolved questions for next time'),
      },
    },
    async ({ ticket, approach, what_happened, outcome, commits, open_questions }) => {
      const session = await logSession(
        root,
        {
          ticket,
          actor: agentActor(root),
          approach,
          whatHappened: what_happened,
          outcome,
          commits: commits ?? [],
          openQuestions: open_questions ?? [],
        },
        {},
      );
      return text({ session });
    },
  );

  server.registerTool(
    'set_active_ticket',
    {
      title: 'Set or clear the active Lovelace ticket',
      description:
        'Record which ticket this session is working on. Set it when you start working a ticket and clear it (pass null) after writing the session record. The active ticket is injected into commit messages by the Git hook, surfaced in the digest, and checked by the session-record guard when the session ends. Passing an unknown ticket ID is an error.',
      inputSchema: {
        id: z
          .string()
          .nullable()
          .describe('Ticket ID to set as active, for example "T-0042"; null clears it'),
      },
    },
    async ({ id }) => {
      setActiveTicket(root, id);
      return text({ activeTicket: getActiveTicket(root) });
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Search Lovelace entities',
      description:
        'Plain text search across ticket titles and bodies, documents, sessions and comments. Returns ranked hits with a snippet. Use it to find prior work, decisions, or discussions before starting something that may already exist.',
      inputSchema: {
        query: z.string().describe('Substring to search for, case-insensitive'),
      },
    },
    async ({ query }) => {
      const project = loadProject(root);
      return text({ hits: search(project, query) });
    },
  );

  return server;
}

/** Reads the digest section bodies a session-check needs. */
export function sessionsForTicket(root: string, ticket: string): Array<{ id: string; openQuestions: string }> {
  const project = loadProject(root);
  return project.sessions
    .filter((s) => s.ticket === ticket)
    .map((s) => ({ id: s.id, openQuestions: extractSection(s.body, 'Open questions') ?? '' }));
}

const bun = (globalThis as { Bun?: { main?: string } }).Bun;
const isMain =
  process.argv[1]?.endsWith('server.js') ||
  process.argv[1]?.endsWith('lovelace-mcp') ||
  process.argv[1]?.endsWith('lovelace-mcp.exe') ||
  (bun?.main !== undefined && bun.main.endsWith('server.ts'));
if (isMain) {
  const root = process.env.LOVELACE_ROOT ?? process.cwd();
  const server = buildServer(root);
  const transport = new StdioServerTransport();
  void server.connect(transport);
}
