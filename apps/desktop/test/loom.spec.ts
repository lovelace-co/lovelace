import { describe, expect, it } from 'vitest';
import { epicProgress, priorityFamily, statusHue } from '../src/lib/loom';
import type { Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;
const schema = snapshot.schema;

describe('status hues', () => {
  it('maps schema positions to the four learned hues', () => {
    expect(statusHue(schema, 'backlog')).toBe('pre'); // before in_progress
    expect(statusHue(schema, 'todo')).toBe('pre'); // ready, but before in_progress
    expect(statusHue(schema, 'in_progress')).toBe('current'); // the one working status
    expect(statusHue(schema, 'in_review')).toBe('review'); // untagged, between in_progress and done
    expect(statusHue(schema, 'done')).toBe('done');
    // cancelled sits after done with no role: neutral, not "in review".
    expect(statusHue(schema, 'cancelled')).toBe('pre');
    expect(statusHue(schema, 'nonsense')).toBe('pre');
  });
});

describe('urgency pill families', () => {
  it('maps the priorities list front-to-back into high, med, low', () => {
    expect(priorityFamily(schema, 'urgent')).toBe('high');
    expect(priorityFamily(schema, 'high')).toBe('high');
    expect(priorityFamily(schema, 'medium')).toBe('med');
    expect(priorityFamily(schema, 'low')).toBe('low');
    expect(priorityFamily(schema, 'unknown')).toBeNull();
  });
});

describe('epic punch rows', () => {
  it('derives one hole per child: punched when complete, reading where work sits', () => {
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
