import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpecGate } from '../src/components/SpecGate';
import type { MigrationPlan } from '../src/lib/types';

const plan: MigrationPlan = {
  declared: '2.1.0',
  target: '3.1.0',
  steps: [
    {
      summary: 'upgrades the 2.x workflow format to 3.0',
      changes: ['nest 4 fields under their types', 'rename workflow.yaml to schema.yaml'],
    },
  ],
};

describe('SpecGate', () => {
  it('renders the too-new screen naming both versions', () => {
    render(<SpecGate code="spec-too-new" declared="4.0.0" supported="3.0.0" />);
    expect(screen.getByRole('heading', { name: 'This project needs a newer Lovelace' })).toBeTruthy();
    const body = screen.getByText(/It uses format/);
    expect(body.textContent).toContain('4.0.0');
    expect(body.textContent).toContain('3.x');
    expect(body.textContent).toContain('Update Lovelace to open it.');
    // No migration controls on the too-new branch.
    expect(screen.queryByRole('button', { name: 'Update project' })).toBeNull();
  });

  it('renders the needs-migration screen naming both versions, with no plan until one is passed', () => {
    render(<SpecGate code="spec-needs-migration" declared="2.1.0" supported="3.0.0" />);
    expect(screen.getByRole('heading', { name: 'This project uses an older format' })).toBeTruthy();
    const body = screen.getByText(/It declares format/);
    expect(body.textContent).toContain('2.1.0');
    expect(body.textContent).toContain('3.x');
    expect(screen.getByText(/Commit or back up your project first/)).toBeTruthy();
    // The button exists but is disabled until a plan has loaded.
    expect((screen.getByRole('button', { name: 'Update project' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the plan lines and lets the user trigger the migration', () => {
    const onMigrate = vi.fn();
    render(
      <SpecGate
        code="spec-needs-migration"
        declared="2.1.0"
        supported="3.0.0"
        plan={plan}
        onMigrate={onMigrate}
      />,
    );
    expect(screen.getByText('upgrades the 2.x workflow format to 3.0')).toBeTruthy();
    expect(screen.getByText('nest 4 fields under their types')).toBeTruthy();
    expect(screen.getByText('rename workflow.yaml to schema.yaml')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Update project' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });

  it('disables the button while migrating and surfaces a failure message', () => {
    render(
      <SpecGate
        code="spec-needs-migration"
        declared="2.1.0"
        supported="3.0.0"
        plan={plan}
        migrating
        migrateError="migration failed: could not write schema.yaml"
      />,
    );
    expect((screen.getByRole('button', { name: 'Update project' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('migration failed: could not write schema.yaml')).toBeTruthy();
  });
});
