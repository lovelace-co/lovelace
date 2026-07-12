import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InitWizard } from '../src/components/InitWizard';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';
import type { Schema } from '../src/lib/types';

const DEFAULTS: Schema = {
  types: [
    { name: 'task', id_prefix: 'T', fields: [{ name: 'title', type: 'string', required: true }] },
    { name: 'bug', id_prefix: 'B', fields: [{ name: 'title', type: 'string', required: true }] },
  ],
  statuses: [{ name: 'todo' }, { name: 'done', agent: 'complete' }],
  priorities: ['high', 'low'],
};

function renderWizard() {
  const host = new FakeHost();
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <HostProvider host={host}>
      <InitWizard initTarget="/repo" defaults={DEFAULTS} initialName="Demo" onCancel={onCancel} onDone={onDone} />
    </HostProvider>,
  );
  const initArgs = () => host.calls.find((c) => c.method === 'init')?.args;
  return { host, onDone, onCancel, initArgs };
}

const next = () => fireEvent.click(screen.getByText('Next'));

describe('InitWizard', () => {
  it('seeds the project name and the Use defaults path sends no schema', async () => {
    const { onDone, initArgs } = renderWizard();
    expect((screen.getByLabelText('project name') as HTMLInputElement).value).toBe('Demo');
    fireEvent.click(screen.getByText('Use defaults'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    expect(initArgs()![3]).toBeUndefined();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('/repo'));
  });

  it('walking through unchanged still takes the default path', async () => {
    const { initArgs } = renderWizard();
    next(); // Statuses
    next(); // Types
    next(); // Review
    fireEvent.click(screen.getByText('Initialise project'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    expect(initArgs()![3]).toBeUndefined();
  });

  it('a human label auto-fills the machine name until the machine is edited', () => {
    renderWizard();
    next(); // Statuses
    const label = screen.getByLabelText('status 0 label') as HTMLInputElement;
    const machine = screen.getByLabelText('status 0 machine') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'In Review' } });
    expect(machine.value).toBe('in_review');
    // Once the machine is hand-edited, it no longer follows the label.
    fireEvent.change(machine, { target: { value: 'review' } });
    fireEvent.change(label, { target: { value: 'Reviewing' } });
    expect(machine.value).toBe('review');
  });

  it('customising a status sends a schema carrying the edit', async () => {
    const { initArgs } = renderWizard();
    next(); // Statuses
    fireEvent.change(screen.getByLabelText('status 0 label'), { target: { value: 'Inbox' } });
    next(); // Types
    next(); // Review
    fireEvent.click(screen.getByText('Initialise project'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    const schema = initArgs()![3] as Schema;
    expect(schema).toBeDefined();
    expect(schema.statuses[0]!.name).toBe('inbox');
  });

  it('selecting an agent role on one status clears it from any other', () => {
    renderWizard();
    next(); // Statuses
    fireEvent.click(screen.getByLabelText('status 0 agent role Ready'));
    fireEvent.click(screen.getByLabelText('status 1 agent role Ready'));
    expect((screen.getByLabelText('status 0 agent role Ready') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('status 1 agent role Ready') as HTMLInputElement).checked).toBe(true);
  });

  it('pins Title and Body as locked default field rows and can add a field', () => {
    renderWizard();
    next(); // Statuses
    next(); // Types
    // Title and Body read as static rows: no inputs, and clicking them opens nothing.
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.queryByLabelText('title field name')).toBeNull();
    expect(screen.queryByLabelText('body field name')).toBeNull();
    fireEvent.click(screen.getByText('Title'));
    expect(screen.queryByLabelText('field 0 label')).toBeNull();
    fireEvent.click(screen.getByText('Add field'));
    // The new field row appears (index 1, after the locked title) already open for editing.
    expect(screen.getByLabelText('field 1 label')).toBeTruthy();
  });

  it('an enum field offers a reorderable value list with a default radio', () => {
    renderWizard();
    next(); // Statuses
    next(); // Types
    fireEvent.click(screen.getByText('Add field'));
    fireEvent.click(screen.getByLabelText('field 1 type'));
    fireEvent.click(screen.getByRole('option', { name: 'enum' }));
    fireEvent.click(screen.getByText('Add value'));
    const value = screen.getByLabelText('field 1 value 0') as HTMLInputElement;
    fireEvent.change(value, { target: { value: 'Blocked' } });
    expect(value.value).toBe('Blocked');
    // A radio marks it as the default.
    expect(screen.getByLabelText('field 1 value 0 default')).toBeTruthy();
  });

  it('an enum sourced from Priorities can still set a default (for quick-add)', async () => {
    const { initArgs } = renderWizard();
    next(); // Statuses
    next(); // Types
    fireEvent.click(screen.getByText('Add field'));
    fireEvent.click(screen.getByLabelText('field 1 type'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'field 1 type' })).getByText('enum'));
    fireEvent.click(screen.getByLabelText('field 1 values from'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'field 1 values from' })).getByText('From: Priorities'));
    fireEvent.click(screen.getByLabelText('field 1 default'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'field 1 default' })).getByText('High'));
    next(); // Review
    fireEvent.click(screen.getByText('Initialise project'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    const schema = initArgs()![3] as Schema;
    const field = schema.types[0]!.fields.find((f) => f.name === 'new_field');
    expect(field?.values_from).toBe('priorities');
    expect(field?.default).toBe('high');
  });

  it('switching tabs shows the other type\'s fields', () => {
    renderWizard();
    next(); // Statuses
    next(); // Types
    // Task is active by default; add a field scoped to it.
    fireEvent.click(screen.getByText('Add field'));
    fireEvent.change(screen.getByLabelText('field 1 label'), { target: { value: 'Points' } });
    // Switching to Bug hides Task's Points field...
    fireEvent.click(screen.getByRole('tab', { name: 'Bug' }));
    expect(screen.queryByLabelText('field 1 label')).toBeNull();
    expect(screen.queryByText('Points')).toBeNull();
    // ...and switching back to Task shows it again, read-only until reopened.
    fireEvent.click(screen.getByRole('tab', { name: 'Task' }));
    expect(screen.queryByLabelText('field 1 label')).toBeNull();
    fireEvent.click(screen.getByText('Points'));
    expect((screen.getByLabelText('field 1 label') as HTMLInputElement).value).toBe('Points');
  });

  it('switches type tabs and adds a field scoped to that type only', async () => {
    const { initArgs } = renderWizard();
    next(); // Statuses
    next(); // Types
    fireEvent.click(screen.getByRole('tab', { name: 'Bug' }));
    fireEvent.click(screen.getByText('Add field'));
    next(); // Review
    fireEvent.click(screen.getByText('Initialise project'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    const schema = initArgs()![3] as Schema;
    const task = schema.types.find((t) => t.name === 'task')!;
    const bug = schema.types.find((t) => t.name === 'bug')!;
    expect(bug.fields.length).toBe(DEFAULTS.types[1]!.fields.length + 1);
    expect(task.fields.length).toBe(DEFAULTS.types[0]!.fields.length);
  });
});
