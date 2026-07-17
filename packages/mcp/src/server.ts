#!/usr/bin/env node
/**
 * The Lovelace MCP server: eight tools over packages/core, stdio transport.
 * Tool descriptions are written for agent consumption. Every mutation
 * triggers a re-index through core.
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
  fieldsForType,
  enumValues,
} from '@lovelace/core';
import type { Schema, FieldDef } from '@lovelace/core';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from './version.js';

function agentActor(root: string): string {
  const project = loadProject(root);
  return project.actors.find((a) => a.kind === 'agent')?.id ?? 'claude';
}

/** Indefinite article for a bare noun, for example "an epic" or "a task". */
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/**
 * The value hint for a reference field's targets: `actor` and `document`
 * are not ticket types so they get their own wording, a single ticket-type
 * target gets a worked example built from that type's real id_prefix, and
 * multiple targets are just named without an example. `plural` renders the
 * wording a list field needs ("ids" and a JSON array example) instead of
 * the scalar one.
 */
function referenceHint(schema: Schema, targets: string[] | undefined, plural: boolean): string {
  const list = targets ?? [];
  if (list.length === 1 && list[0] === 'actor') {
    return plural ? 'actor ids from actors.yaml' : 'an actor id from actors.yaml';
  }
  if (list.length === 1 && list[0] === 'document') {
    return plural ? 'document ids' : 'a document id';
  }
  if (list.length === 0) {
    return plural ? 'ids, for example ["T-0001"]' : 'an id, for example "T-0001"';
  }
  const named = [withArticle(list[0]), ...list.slice(1)];
  const phrase =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
  if (list.length === 1) {
    const prefix = schema.types.find((t) => t.name === list[0])?.id_prefix ?? 'T';
    return plural
      ? `ids of ${phrase}, for example ["${prefix}-0001"]`
      : `the id of ${phrase}, for example "${prefix}-0001"`;
  }
  return plural ? `ids of ${phrase}` : `the id of ${phrase}`;
}

/** The value hint for a scalar type; `plural` only changes the reference case (see referenceHint). */
function scalarHint(
  schema: Schema,
  field: FieldDef,
  type: Exclude<FieldDef['type'], 'list'>,
  plural: boolean,
): string {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'date':
      return 'a date, YYYY-MM-DD';
    case 'enum':
      return `one of: ${enumValues(schema, field).join(', ')}`;
    case 'reference':
      return referenceHint(schema, field.refers_to, plural);
  }
}

/**
 * A short plain-English hint for a legal value of this field: feeds both
 * the generated tool descriptions below and describe_schema, so an agent
 * sees the same wording everywhere it is offered.
 */
function fieldHint(schema: Schema, field: FieldDef): string {
  const base =
    field.type === 'list'
      ? `a list of ${scalarHint(schema, field, field.item_type ?? 'string', true)}`
      : scalarHint(schema, field, field.type, false);
  let hint = base;
  if (field.required) hint += '; required';
  if (field.default !== undefined) hint += `; defaults to ${JSON.stringify(field.default)}`;
  return hint;
}

/** One line per type, for example `task: title (text; required), parent (...)`. */
function typeFieldsLine(schema: Schema, typeName: string): string {
  const defs = fieldsForType(schema, typeName);
  if (defs.length === 0) return `${typeName}: no fields beyond the core set`;
  return `${typeName}: ${defs.map((f) => `${f.name} (${fieldHint(schema, f)})`).join(', ')}`;
}

/** The per-type field guide shared by create_ticket's and update_ticket's `fields` descriptions. */
function typeFieldsGuide(schema: Schema): string {
  return schema.types.map((t) => typeFieldsLine(schema, t.name)).join('\n');
}

/**
 * Assembles the whole ticket schema for the describe_schema tool: each
 * type's fields with enum values resolved (mirrors fieldCatalogue, but
 * nested under its type and with enum options filled in for the agent).
 */
function describeSchema(root: string) {
  const schema = loadProject(root).schema;
  return {
    types: schema.types.map((t) => ({
      name: t.name,
      ...(t.label ? { label: t.label } : {}),
      ...(t.plural ? { plural: t.plural } : {}),
      id_prefix: t.id_prefix,
      fields: fieldsForType(schema, t.name).map((f) => ({
        name: f.name,
        type: f.type,
        ...(f.required ? { required: true } : {}),
        ...(f.type === 'enum' ? { values: enumValues(schema, f) } : {}),
        ...(f.item_type ? { item_type: f.item_type } : {}),
        ...(f.refers_to ? { refers_to: f.refers_to } : {}),
        ...(f.default !== undefined ? { default: f.default } : {}),
        ...(f.label ? { label: f.label } : {}),
        hint: fieldHint(schema, f),
      })),
    })),
    statuses: schema.statuses.map((s) => ({
      name: s.name,
      ...(s.label ? { label: s.label } : {}),
      ...(s.agent ? { agent: s.agent } : {}),
    })),
    priorities: schema.priorities,
  };
}

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

export function buildServer(root: string): McpServer {
  const server = new McpServer({ name: 'lovelace', version: APP_VERSION });

  // A snapshot of the schema taken at registration: it drives the generated
  // tool descriptions and the create_ticket type enum below. Core reloads
  // and revalidates the schema on every call regardless, so a schema.yaml
  // edited mid-session can leave this snapshot (and the descriptions built
  // from it) stale without making any call unsafe. A broken schema.yaml
  // must not stop the server from starting: schema stays null and every
  // tool falls back to its static description, with the config error
  // surfacing per call as it does today.
  let schema: Schema | null;
  try {
    schema = loadProject(root).schema;
  } catch {
    schema = null;
  }
  const createTypeNames = schema?.types.map((t) => t.name) ?? [];

  server.registerTool(
    'create_ticket',
    {
      title: 'Create a Lovelace ticket',
      description:
        'Create a ticket (task, bug, epic or any type defined in schema.yaml). Use this instead of writing files in .lovelace/tickets/. Call describe_schema first to see the fields defined for the type and the statuses available; setting a field that is not defined is rejected. Core fields (id, status, created, updated) are assigned for you. Write the description, acceptance criteria and any other prose with the body parameter, not as a field. Returns the created ticket including its ID.',
      inputSchema: {
        type:
          createTypeNames.length > 0
            ? z
                .enum(createTypeNames as [string, ...string[]])
                .describe(`A ticket type defined in schema.yaml: ${createTypeNames.join(', ')}`)
            : z.string().describe('A ticket type defined in schema.yaml, for example "task" or "bug"'),
        fields: z
          .record(z.unknown())
          .describe(
            schema
              ? `Defined field values, for example {"title": "...", "priority": "high"}\n${typeFieldsGuide(schema)}`
              : 'Defined field values, for example {"title": "...", "priority": "high"}',
          ),
        body: z
          .string()
          .optional()
          .describe(
            'Markdown body written below the frontmatter: the description, acceptance criteria, and any other prose. Not a frontmatter field.',
          ),
      },
    },
    async ({ type, fields, body }) => {
      const ticket = await createTicket(root, { type, fields, body }, { actor: agentActor(root) });
      return text({ ticket });
    },
  );

  server.registerTool(
    'update_ticket',
    {
      title: 'Update or move a Lovelace ticket',
      description:
        'Update defined fields on a ticket, or change its status by including "status" in fields. A status may move to any status defined in schema.yaml; call describe_schema to see the fields and statuses available. Locked core fields cannot be edited, and a field not defined on the ticket\'s type is rejected. Set a field to null to remove it. Replace the body with the body parameter, not as a field.',
      inputSchema: {
        id: z.string().describe('Ticket ID, for example "T-0042"'),
        fields: z
          .record(z.unknown())
          .optional()
          .describe(
            schema
              ? `Field changes:\n${typeFieldsGuide(schema)}\nInclude "status" to move the ticket: one of ${schema.statuses
                  .map((s) => s.name)
                  .join(', ')}. Optional when only replacing the body.`
              : 'Field changes; include "status" to move the ticket. Optional when only replacing the body.',
          ),
        body: z
          .string()
          .optional()
          .describe('Replaces the whole markdown body; omit to leave the body unchanged.'),
      },
    },
    async ({ id, fields, body }) => {
      const actor = agentActor(root);
      const result = await updateTicket(root, id, { fields, body }, { actor });
      return text({ ticket: result.ticket });
    },
  );

  server.registerTool(
    'describe_schema',
    {
      title: 'Describe the Lovelace ticket schema',
      description:
        'Return the whole ticket schema: every ticket type with its fields (enum fields include their resolved allowed values), every status with its optional agent role, and the priority list. Each field also carries a hint describing what a legal value looks like. Call this before create_ticket or update_ticket to see what you may set. A status\'s "agent" role tells you where to find and manage your own work: "ready" is work you may pick up, "in_progress" is the status to move a ticket to while you work it, and "complete" is the status that marks it done. update_ticket accepts a move to any status listed here; there is no further gating on the move.',
      inputSchema: {},
    },
    async () => {
      return text(describeSchema(root));
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
