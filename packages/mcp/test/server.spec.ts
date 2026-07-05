import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
  it('exposes exactly seven tools', async () => {
    const client = await connect(fixture());
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'create_ticket',
      'log_session',
      'query_tickets',
      'read_document',
      'search',
      'set_active_ticket',
      'update_ticket',
    ]);
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
    expect(ticket.id).toBe('T-0005');
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

  it('rejects illegal transitions with the legal targets named', async () => {
    const client = await connect(fixture());
    const result = await client.callTool({
      name: 'update_ticket',
      arguments: { id: 'T-0003', fields: { status: 'done' } },
    });
    expect(result.isError).toBe(true);
    const message = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(message).toContain('illegal transition');
    expect(message).toContain('in_progress');
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

  it('agent-initiated automations return the instruction inline to act on now', async () => {
    const root = fixture();
    const client = await connect(root);
    await client.callTool({ name: 'update_ticket', arguments: { id: 'T-0002', fields: { status: 'in_review' } } });
    const result = parse(
      await client.callTool({ name: 'update_ticket', arguments: { id: 'T-0002', fields: { status: 'staging' } } }),
    );
    const automation = result.automation as { instructions: string[]; queued: string[] };
    expect(automation.instructions).toHaveLength(1);
    expect(automation.instructions[0]).toContain('Deploy');
    expect(automation.queued).toHaveLength(0);
  });
});
