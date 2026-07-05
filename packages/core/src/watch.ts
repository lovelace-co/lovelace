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
  const indexDirPlain = join(dir, project.manifest.paths.index);
  const stateDirPlain = join(dir, project.manifest.paths.state);
  const indexDir = indexDirPlain + sep;
  const stateDir = stateDirPlain + sep;

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
    ignored: (path: string) =>
      // The live-agent marker is the one state/ file watchers react to.
      path !== join(stateDirPlain, 'presence.json') &&
      (path === indexDirPlain ||
        path === stateDirPlain ||
        path.startsWith(indexDir) ||
        path.startsWith(stateDir)),
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
