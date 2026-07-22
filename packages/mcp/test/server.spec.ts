import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadProject, validateProject } from '@lovelace/core';
import { buildServer } from '../src/server.js';
import { tempFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function connect(root: string) {
  const server = buildServer(root);
  const client = new Client({ name: 'test-agent', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(() => void client.close());
  return client;
}

function fixture() {
  const f = tempFixture();
  cleanups.push(f.cleanup);
  return f.root;
}

function parse(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('the MCP server', () => {
  it('exposes exactly eight tools', async () => {
    const client = await connect(fixture());
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'create_ticket',
      'describe_schema',
      'log_session',
      'query_tickets',
      'read_document',
      'search',
      'set_active_ticket',
      'update_ticket',
    ]);
  });

  it('advertises a body parameter on create_ticket and update_ticket', async () => {
    const client = await connect(fixture());
    const tools = await client.listTools();
    const create = tools.tools.find((t) => t.name === 'create_ticket');
    const update = tools.tools.find((t) => t.name === 'update_ticket');
    expect((create?.inputSchema.properties as Record<string, unknown>).body).toBeDefined();
    expect((update?.inputSchema.properties as Record<string, unknown>).body).toBeDefined();
  });

  it('sets and clears the active ticket pointer, validating the ticket exists', async () => {
    const root = fixture();
    const client = await connect(root);
    const set = parse(
      await client.callTool({ name: 'set_active_ticket', arguments: { id: 'T-0002' } }),
    );
    expect(set.activeTicket).toBe('T-0002');
    expect(readFileSync(join(root, '.lovelace/state/active_ticket'), 'utf8').trim()).toBe('T-0002');

    const unknown = await client.callTool({ name: 'set_active_ticket', arguments: { id: 'T-9999' } });
    expect(unknown.isError).toBe(true);

    const cleared = parse(
      await client.callTool({ name: 'set_active_ticket', arguments: { id: null } }),
    );
    expect(cleared.activeTicket).toBeNull();
  });

  it('runs the full agent loop: query, create, transition, log, and the files still validate', async () => {
    const root = fixture();
    const client = await connect(root);

    const inProgress = parse(
      await client.callTool({ name: 'query_tickets', arguments: { filters: { status: 'in_progress' } } }),
    );
    expect((inProgress.tickets as Array<{ id: string }>).map((t) => t.id)).toContain('T-0002');

    const created = parse(
      await client.callTool({
        name: 'create_ticket',
        arguments: { type: 'task', fields: { title: 'Current conditions endpoint', estimate: 2 } },
      }),
    );
    const ticket = created.ticket as { id: string; status: string };
    // Tracks the demo fixture's ticket count: the next assigned ID after
    // T-0001 through T-0005 is T-0006.
    expect(ticket.id).toBe('T-0006');
    expect(ticket.status).toBe('backlog');

    const moved = parse(
      await client.callTool({
        name: 'update_ticket',
        arguments: { id: ticket.id, fields: { status: 'todo' } },
      }),
    );
    expect((moved.ticket as { status: string }).status).toBe('todo');

    const logged = parse(
      await client.callTool({
        name: 'log_session',
        arguments: {
          ticket: ticket.id,
          approach: 'Plan the endpoint.',
          what_happened: 'Scoped the work.',
          outcome: 'partial',
          commits: [],
          open_questions: ['Reuse the forecast cache reader?'],
        },
      }),
    );
    expect((logged.session as { id: string }).id).toBe('S-0003');

    const issues = validateProject(loadProject(root));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('creates a ticket with a body, which lands below the frontmatter', async () => {
    const root = fixture();
    const client = await connect(root);
    const created = parse(
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          type: 'task',
          fields: { title: 'Has a written body' },
          body: '## Description\n\nWritten from the tool call.\n',
        },
      }),
    );
    const ticket = created.ticket as { id: string; body: string; path: string };
    expect(ticket.body.trim()).toBe('## Description\n\nWritten from the tool call.');
    const content = readFileSync(join(root, ticket.path), 'utf8');
    expect(content).toContain('---\n\n## Description\n\nWritten from the tool call.\n');
  });

  it('replaces a ticket body via update_ticket', async () => {
    const root = fixture();
    const client = await connect(root);
    const updated = parse(
      await client.callTool({
        name: 'update_ticket',
        arguments: { id: 'T-0002', fields: {}, body: 'Replaced by the tool call.\n' },
      }),
    );
    const ticket = updated.ticket as { body: string };
    expect(ticket.body.trim()).toBe('Replaced by the tool call.');
    const content = readFileSync(join(root, '.lovelace/tickets/T-0002.md'), 'utf8');
    expect(content).toContain('---\n\nReplaced by the tool call.\n');
  });

  it('surfaces the redirect error when the body is passed as a field', async () => {
    const client = await connect(fixture());
    const result = await client.callTool({
      name: 'update_ticket',
      arguments: { id: 'T-0002', fields: { body: 'nope' } },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain(
      '"body" is not a frontmatter field; pass the ticket body with the body parameter',
    );
  });

  it('rejects edits to locked core fields', async () => {
    const client = await connect(fixture());
    const result = await client.callTool({
      name: 'update_ticket',
      arguments: { id: 'T-0003', fields: { created: '2020-01-01T00:00:00Z' } },
    });
    expect(result.isError).toBe(true);
  });

  it('queries by custom fields', async () => {
    const client = await connect(fixture());
    const result = parse(
      await client.callTool({
        name: 'query_tickets',
        arguments: { filters: { environment: 'staging' } },
      }),
    );
    expect((result.tickets as Array<{ id: string }>).map((t) => t.id)).toEqual(['T-0004']);
  });

  it('reads documents by id, path and directory', async () => {
    const client = await connect(fixture());
    const byId = parse(await client.callTool({ name: 'read_document', arguments: { id_or_path: 'ADR-0001' } }));
    expect(String(byId.body)).toContain('File cache instead of a database');

    // A directory prefers its index.md as the entry point and lists its children.
    const byDir = parse(
      await client.callTool({ name: 'read_document', arguments: { id_or_path: '.lovelace/documentation' } }),
    );
    expect(String(byDir.index).length).toBeGreaterThan(0);
    const children = byDir.children as Array<{ id: string }>;
    expect(children.some((c) => c.id === 'architecture-overview')).toBe(true);
    expect(children.some((c) => c.id === 'ADR-0001')).toBe(true);
  });

  it('searches across entities', async () => {
    const client = await connect(fixture());
    const result = parse(await client.callTool({ name: 'search', arguments: { query: 'gusts' } }));
    const hits = result.hits as Array<{ id: string }>;
    expect(hits.some((h) => h.id === 'T-0004')).toBe(true);
  });

  it('describes the schema: nested type fields with enum values resolved, statuses with agent roles, priorities', async () => {
    const client = await connect(fixture());
    const result = parse(await client.callTool({ name: 'describe_schema', arguments: {} }));

    const types = result.types as Array<{ name: string; id_prefix: string; fields: Array<Record<string, unknown>> }>;
    const bug = types.find((t) => t.name === 'bug');
    expect(bug?.id_prefix).toBe('T');
    const environment = bug?.fields.find((f) => f.name === 'environment');
    expect(environment).toMatchObject({
      type: 'enum',
      required: true,
      values: ['local', 'dev', 'staging', 'production'],
    });
    const task = types.find((t) => t.name === 'task');
    const priority = task?.fields.find((f) => f.name === 'priority');
    expect(priority).toMatchObject({ type: 'enum', values: ['urgent', 'high', 'medium', 'low'] });
    expect(priority?.hint).toContain('urgent, high, medium, low');

    // Every field carries a hint, and a reference field's hint names an
    // example id built from its target type's real id_prefix.
    for (const type of types) {
      for (const field of type.fields) {
        expect(typeof field.hint).toBe('string');
        expect((field.hint as string).length).toBeGreaterThan(0);
      }
    }
    const parent = task?.fields.find((f) => f.name === 'parent');
    expect(parent?.hint).toContain('E-0001');

    const statuses = result.statuses as Array<{ name: string; agent?: string }>;
    expect(statuses.find((s) => s.name === 'todo')?.agent).toBe('ready');
    expect(statuses.find((s) => s.name === 'in_progress')?.agent).toBe('in_progress');
    expect(statuses.find((s) => s.name === 'in_review')?.agent).toBe('complete');
    expect(statuses.find((s) => s.name === 'done')?.agent).toBeUndefined();
    expect(statuses.find((s) => s.name === 'backlog')?.agent).toBeUndefined();

    expect(result.priorities).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('advertises the create_ticket type enum and per-type field hints, generated from schema.yaml', async () => {
    const client = await connect(fixture());
    const tools = await client.listTools();
    const create = tools.tools.find((t) => t.name === 'create_ticket');
    const update = tools.tools.find((t) => t.name === 'update_ticket');

    const typeSchema = (create?.inputSchema.properties as Record<string, { enum?: string[] }>).type;
    expect(typeSchema?.enum).toEqual(['epic', 'task', 'bug']);

    const createFields = (create?.inputSchema.properties as Record<string, { description?: string }>).fields;
    const updateFields = (update?.inputSchema.properties as Record<string, { description?: string }>).fields;
    expect(createFields?.description).toContain('one of: urgent, high, medium, low');
    expect(updateFields?.description).toContain('one of: urgent, high, medium, low');
    expect(updateFields?.description).toContain(
      'one of backlog, todo, in_progress, in_review, done, cancelled',
    );
  });

  it('surfaces the version classification for a project newer than the supported major', async () => {
    // The too-new branch is the reachable spec mismatch while the supported
    // major is 0 (T-0109); nothing can classify needs-migration below it.
    const root = fixture();
    const manifestPath = join(root, '.lovelace/manifest.yaml');
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('0.1.0', '4.0.0'));

    const client = await connect(root);
    const result = await client.callTool({ name: 'search', arguments: { query: 'weather' } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('update lovelace');
  });

  it('falls back to the static descriptions and surfaces the config error per call when schema.yaml is broken', async () => {
    const root = fixture();
    const schemaPath = join(root, '.lovelace/schema.yaml');
    writeFileSync(schemaPath, `${readFileSync(schemaPath, 'utf8')}  bad   indentation: [unclosed\n`);

    const client = await connect(root);
    const tools = await client.listTools();
    const create = tools.tools.find((t) => t.name === 'create_ticket');
    const update = tools.tools.find((t) => t.name === 'update_ticket');
    const properties = create?.inputSchema.properties as Record<string, { type?: string; description?: string }>;
    expect(properties.type).toMatchObject({ type: 'string' });
    expect(properties.fields.description).toBe(
      'Defined field values, for example {"title": "...", "priority": "high"}',
    );
    const updateFields = (update?.inputSchema.properties as Record<string, { description?: string }>).fields;
    expect(updateFields?.description).toBe(
      'Field changes; include "status" to move the ticket. Optional when only replacing the body.',
    );

    const result = await client.callTool({
      name: 'create_ticket',
      arguments: { type: 'task', fields: { title: 'Whatever' } },
    });
    expect(result.isError).toBe(true);
  });
});
