import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPalette } from '../src/components/SearchPalette';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';

describe('SearchPalette', () => {
  it('shows the Cmd/Ctrl+K shortcut hint in the foot', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <SearchPalette root="/fake" onPick={vi.fn()} onClose={vi.fn()} />
      </HostProvider>,
    );
    // jsdom is not macOS, so the non-mac shortcut label is expected here.
    expect(screen.getByText('ctrl+K opens this search')).toBeTruthy();
  });
});
