import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InitWizard } from '../src/components/InitWizard';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';
import type { Workflow } from '../src/lib/types';

const DEFAULTS: Workflow = {
  types: [{ name: 'task', id_prefix: 'T' }],
  statuses: [{ name: 'todo' }, { name: 'done', complete: true }],
  transitions: [{ from: 'todo', to: ['done'] }],
  priorities: ['high', 'low'],
  fields: [{ name: 'title', type: 'string', required: true }],
  on_transition: [],
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
  it('seeds the project name and the Use defaults path sends no workflow', async () => {
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
    next(); // Types & Fields
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

  it('customising a status sends a workflow config carrying the edit', async () => {
    const { initArgs } = renderWizard();
    next(); // Statuses
    fireEvent.change(screen.getByLabelText('status 0 label'), { target: { value: 'Inbox' } });
    next(); // Types & Fields
    next(); // Review
    fireEvent.click(screen.getByText('Initialise project'));
    await waitFor(() => expect(initArgs()).toBeDefined());
    const workflow = initArgs()![3] as Workflow;
    expect(workflow).toBeDefined();
    expect(workflow.statuses[0]!.name).toBe('inbox');
    expect(workflow.transitions.find((t) => t.from === 'inbox')?.to).toContain('done');
  });

  it('pins Title and Body as locked default field rows and can add a field', () => {
    renderWizard();
    next(); // Statuses
    next(); // Types & Fields
    const title = screen.getByLabelText('title field name') as HTMLInputElement;
    const body = screen.getByLabelText('body field name') as HTMLInputElement;
    expect(title.value).toBe('Title');
    expect(title.readOnly).toBe(true);
    expect(body.value).toBe('Body');
    fireEvent.click(screen.getByText('Add field'));
    // The new editable field row appears (index 1, after the locked title).
    expect(screen.getByLabelText('field 1 label')).toBeTruthy();
  });

  it('an enum field offers a reorderable value list with a default radio', () => {
    renderWizard();
    next(); // Statuses
    next(); // Types & Fields
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
    next(); // Types & Fields
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
    const field = (initArgs()![3] as Workflow).fields.find((f) => f.name === 'new_field');
    expect(field?.values_from).toBe('priorities');
    expect(field?.default).toBe('high');
  });

  it('priorities are an editable list, not a comma field', () => {
    renderWizard();
    next();
    next();
    expect((screen.getByLabelText('priority 0') as HTMLInputElement).value).toBe('high');
    fireEvent.click(screen.getByText('Add priority'));
    expect(screen.getByLabelText('priority 2')).toBeTruthy();
  });
});
