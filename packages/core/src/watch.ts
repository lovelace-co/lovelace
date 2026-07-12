import { watch, type FSWatcher } from 'chokidar';
import { join, sep } from 'node:path';
import { loadProject } from './project.js';
import { validateProject } from './validate.js';
import { writeIndex } from './index-gen.js';
import type { Project, ValidationIssue } from './types.js';

export interface WatchResult {
  project: Project;
  issues: ValidationIssue[];
  changedPaths: string[];
}

export interface Watcher {
  close: () => Promise<void>;
}

/**
 * Watches a project's .lovelace directory and re-validates plus re-indexes
 * on change, debounced. The generated index and machine-local state are
 * excluded so the watcher never reacts to its own writes.
 */
export function watchProject(
  root: string,
  onChange: (result: WatchResult) => void,
  options: { debounceMs?: number; onError?: (e: Error) => void } = {},
): Watcher {
  const debounceMs = options.debounceMs ?? 200;
  const dir = join(root, '.lovelace');
  const project = loadProject(root);
  // Every comparison in the ignore filter happens on forward-slash form:
  // on Windows the paths chokidar hands the ignored callback do not use
  // native separators, so a prefix check against join()-built backslash
  // strings silently never matches. That let the watcher's own index write
  // retrigger it (observed on Windows CI as a doubled onChange per external
  // change); normalising both sides makes the filter hold on any platform.
  const slashes = (p: string) => p.split(sep).join('/');
  const indexDirPlain = slashes(join(dir, project.manifest.paths.index));
  const stateDirPlain = slashes(join(dir, project.manifest.paths.state));
  const indexDir = `${indexDirPlain}/`;
  const stateDir = `${stateDirPlain}/`;
  const presenceDirPlain = `${stateDirPlain}/presence`;
  const presenceDir = `${presenceDirPlain}/`;
  const presenceFile = `${stateDirPlain}/presence.json`;

  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    const changedPaths = [...pending].sort();
    pending = new Set();
    try {
      const fresh = loadProject(root);
      const issues = validateProject(fresh);
      writeIndex(fresh);
      onChange({ project: fresh, issues, changedPaths });
    } catch (e) {
      options.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const watcher: FSWatcher = watch(dir, {
    ignoreInitial: true,
    ignored: (rawPath: string) => {
      // The live-agent markers are the state/ paths watchers react to: the
      // legacy singleton file, and the per-session presence directory
      // (and everything in it). Unlike index/, state/ itself is deliberately
      // left off this list: chokidar v4 prunes traversal at an ignored
      // directory, so ignoring state/ outright would keep it from ever
      // descending far enough to see these exceptions. The startsWith(stateDir)
      // rule below still ignores everything else inside state/.
      const path = slashes(rawPath);
      return (
        path !== presenceFile &&
        path !== presenceDirPlain &&
        !path.startsWith(presenceDir) &&
        (path === indexDirPlain || path.startsWith(indexDir) || path.startsWith(stateDir))
      );
    },
  });
  watcher.on('all', (_event, path) => {
    pending.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  watcher.on('error', (e) => options.onError?.(e instanceof Error ? e : new Error(String(e))));

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
