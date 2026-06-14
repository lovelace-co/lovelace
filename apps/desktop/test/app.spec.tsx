import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { HostProvider } from '../src/state/store';
import { FakeHost } from './fakeHost';

describe('App tabs', () => {
  it('starts on a welcome tab and supports opening more tabs', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );
    expect(screen.getByAltText('Lovelace')).toBeTruthy();
    expect(screen.getAllByText('Welcome').length).toBe(1);
    fireEvent.click(screen.getByLabelText('new tab'));
    expect(screen.getAllByText('Welcome').length).toBe(2);
  });

  it('closing the last tab leaves a fresh welcome tab', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );
    fireEvent.click(screen.getByLabelText('close Welcome'));
    expect(screen.getAllByText('Welcome').length).toBe(1);
  });

  it('Cmd/Ctrl+T opens a new tab', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );
    expect(screen.getAllByText('Welcome').length).toBe(1);
    fireEvent.keyDown(document.body, { key: 't', metaKey: true });
    expect(screen.getAllByText('Welcome').length).toBe(2);
  });

  it('Cmd/Ctrl+W closes the active tab without removing the window', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    expect(screen.getAllByText('Welcome').length).toBe(2);
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true });
    expect(screen.getAllByText('Welcome').length).toBe(1);
  });

  it('tabs are draggable so they can be reordered', () => {
    render(
      <HostProvider host={new FakeHost()}>
        <App />
      </HostProvider>,
    );
    const tab = screen.getByText('Welcome').closest('.tab');
    expect(tab?.getAttribute('draggable')).toBe('true');
  });
});
