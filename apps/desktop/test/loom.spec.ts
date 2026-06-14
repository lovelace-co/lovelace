import { describe, expect, it } from 'vitest';
import { epicProgress, priorityFamily, statusHue } from '../src/lib/loom';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;
const workflow = snapshot.workflow;

describe('status hues', () => {
  it('maps workflow positions to the four learned hues', () => {
    expect(statusHue(workflow, 'backlog')).toBe('pre');
    expect(statusHue(workflow, 'todo')).toBe('pre');
    expect(statusHue(workflow, 'in_progress')).toBe('current'); // first wip carries the signal
    expect(statusHue(workflow, 'in_review')).toBe('review');
    expect(statusHue(workflow, 'staging')).toBe('review');
    expect(statusHue(workflow, 'done')).toBe('done');
    expect(statusHue(workflow, 'cancelled')).toBe('done');
    expect(statusHue(workflow, 'nonsense')).toBe('pre');
  });
});

describe('urgency pill families', () => {
  it('maps the priorities list front-to-back into high, med, low', () => {
    expect(priorityFamily(workflow, 'urgent')).toBe('high');
    expect(priorityFamily(workflow, 'high')).toBe('high');
    expect(priorityFamily(workflow, 'medium')).toBe('med');
    expect(priorityFamily(workflow, 'low')).toBe('low');
    expect(priorityFamily(workflow, 'unknown')).toBeNull();
  });
});

describe('epic punch rows', () => {
  it('derives one hole per child: punched when terminal, reading where work sits', () => {
    const epics = epicProgress(snapshot);
    expect(epics).toHaveLength(1);
    const epic = epics[0]!;
    expect(epic.id).toBe('E-0001');
    expect(epic.title).toBe('Public API v1');
    expect(epic.total).toBe(3); // T-0001..T-0003
    expect(epic.done).toBe(1); // T-0001 is done
    expect(epic.holes).toEqual(['punched', 'reading', 'open']);
  });

  it('returns nothing when no ticket has children', () => {
    const childless: Snapshot = {
      ...snapshot,
      index: {
        ...snapshot.index,
        tickets: snapshot.index.tickets.map((t) => {
          const { parent: _parent, ...fields } = t.fields;
          return { ...t, fields };
        }),
      },
    };
    expect(epicProgress(childless)).toEqual([]);
  });
});
