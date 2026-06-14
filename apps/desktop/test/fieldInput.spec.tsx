import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldInput } from '../src/components/FieldInput';
import type { FieldDef, Snapshot } from '../src/lib/types';
import fixture from './fixtures/snapshot.json';

const snapshot = fixture as unknown as Snapshot;

function renderField(def: FieldDef, value: unknown, onChange = vi.fn()) {
  render(
    <FieldInput
      def={def}
      value={value}
      workflow={snapshot.workflow}
      index={snapshot.index}
      actors={snapshot.actors}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('FieldInput renders from the schema, not hard-coded fields', () => {
  it('enum becomes a dropdown with the declared values', () => {
    const onChange = renderField(
      { name: 'environment', type: 'enum', values: ['local', 'dev', 'staging', 'production'] },
      'staging',
    );
    const trigger = screen.getByLabelText('environment');
    // Values are stored raw but displayed Title Cased.
    expect(trigger.textContent).toContain('Staging');
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'environment' });
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['(none)', 'Local', 'Dev', 'Staging', 'Production']);
    fireEvent.click(within(listbox).getByText('Production'));
    expect(onChange).toHaveBeenCalledWith('production');
  });

  it('enum with values_from priorities uses workflow priorities', () => {
    renderField({ name: 'priority', type: 'enum', values_from: 'priorities' }, 'high');
    fireEvent.click(screen.getByLabelText('priority'));
    const listbox = screen.getByRole('listbox', { name: 'priority' });
    expect(within(listbox).getByText('Urgent')).toBeTruthy();
  });

  it('date becomes a date picker', () => {
    renderField({ name: 'due', type: 'date' }, '2026-07-01');
    const input = screen.getByLabelText('due') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-07-01');
  });

  it('number becomes a numeric input emitting numbers', () => {
    const onChange = renderField({ name: 'estimate', type: 'number' }, 3);
    const input = screen.getByLabelText('estimate') as HTMLInputElement;
    expect(input.type).toBe('number');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('boolean becomes a checkbox', () => {
    const onChange = renderField({ name: 'flagged', type: 'boolean' }, false);
    const box = screen.getByLabelText('flagged') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reference becomes an entity picker narrowed by refers_to', () => {
    renderField({ name: 'parent', type: 'reference', refers_to: ['epic'] }, 'E-0001');
    fireEvent.click(screen.getByLabelText('parent'));
    const listbox = screen.getByRole('listbox', { name: 'parent' });
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('E-0001'))).toBe(true);
    expect(labels.some((l) => l.includes('T-0002'))).toBe(false); // tasks are not epics
    expect(labels.some((l) => l.includes('C-0001'))).toBe(false);
  });

  it('reference to actors lists actors', () => {
    renderField({ name: 'assignee', type: 'reference', refers_to: ['actor'] }, '');
    fireEvent.click(screen.getByLabelText('assignee'));
    const listbox = screen.getByRole('listbox', { name: 'assignee' });
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('ada'))).toBe(true);
    expect(labels.some((l) => l.includes('claude'))).toBe(true);
  });

  it('list becomes a tag input', () => {
    const onChange = renderField({ name: 'labels', type: 'list', item_type: 'string' }, ['api']);
    expect(screen.getByText('api')).toBeTruthy();
    const input = screen.getByLabelText('add labels') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'caching' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['api', 'caching']);
  });

  it('list of references offers entity options and removal', () => {
    const onChange = renderField(
      { name: 'depends_on', type: 'list', item_type: 'reference' },
      ['T-0001'],
    );
    fireEvent.click(screen.getByLabelText('remove T-0001'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
