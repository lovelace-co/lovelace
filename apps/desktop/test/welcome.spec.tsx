import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Welcome } from '../src/views/Welcome';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';

beforeEach(() => localStorage.clear());

describe('Welcome recents', () => {
  it('removes a recent project via its X button and persists the removal', () => {
    localStorage.setItem(
      'lovelace.recents',
      JSON.stringify([
        { root: '/a', name: 'Alpha' },
        { root: '/b', name: 'Beta' },
      ]),
    );
    render(
      <HostProvider host={new FakeHost()}>
        <Welcome onOpenProject={vi.fn()} onInitialised={vi.fn()} />
      </HostProvider>,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('remove Alpha from recents'));
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('lovelace.recents')!)).toEqual([{ root: '/b', name: 'Beta' }]);
  });

  it('opening a recent does not fire when its X is clicked', () => {
    localStorage.setItem('lovelace.recents', JSON.stringify([{ root: '/a', name: 'Alpha' }]));
    const onOpenProject = vi.fn();
    render(
      <HostProvider host={new FakeHost()}>
        <Welcome onOpenProject={onOpenProject} onInitialised={vi.fn()} />
      </HostProvider>,
    );
    fireEvent.click(screen.getByLabelText('remove Alpha from recents'));
    expect(onOpenProject).not.toHaveBeenCalled();
  });
});
