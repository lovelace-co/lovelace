import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostProvider, useProject } from '../src/state/store';
import { FakeHost } from './fakeHost';

/**
 * The watcher-versus-mutation race (mechanism 5, T-0154): a file change
 * landing while `apply` is mid-flight, including its 500ms settle tail,
 * must be replayed once the mutation window closes rather than dropped.
 * The replay must never raise the "changed on disk" toast: an in-window
 * event is almost always the mutation's own write echoing back, not a
 * genuinely external change.
 */
describe('useProject watcher deferral', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays a watcher event that arrives during a mutation, once the settle tail ends', async () => {
    const host = new FakeHost();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HostProvider host={host}>{children}</HostProvider>
    );
    const { result } = renderHook(() => useProject('/proj'), { wrapper });

    // Flush the initial load fired by the mount effect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    const snapshotCallsAfterLoad = host.calls.filter((c) => c.method === 'snapshot').length;

    let resolveMutation!: (value: typeof host.snapshotData) => void;
    const pending = new Promise<typeof host.snapshotData>((resolve) => {
      resolveMutation = resolve;
    });
    let applyPromise!: Promise<unknown>;
    act(() => {
      applyPromise = result.current.apply(() => pending);
    });

    // A file change lands mid-mutation: deferred, not dropped.
    act(() => {
      host.watchHandler?.({ presenceOnly: false });
    });
    expect(result.current.externalChange).toBe(false);
    expect(host.calls.filter((c) => c.method === 'snapshot').length).toBe(snapshotCallsAfterLoad);

    await act(async () => {
      resolveMutation(host.snapshotData);
      await applyPromise;
    });

    // Still within the 500ms settle tail: no replay yet.
    expect(result.current.externalChange).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // The reload happened, but the deferred event never raises the toast.
    expect(host.calls.filter((c) => c.method === 'snapshot').length).toBe(snapshotCallsAfterLoad + 1);
    expect(result.current.externalChange).toBe(false);
  });
});
