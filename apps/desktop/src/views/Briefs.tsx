import { useEffect, useMemo, useState } from 'react';
import { Dropdown } from '../components/Dropdown';
import { AddIcon, CaretIcon, FileIcon, FolderIcon } from '../components/icons';
import { BlockEditor } from '../editor/BlockEditor';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';

interface BriefsProps {
  snapshot: Snapshot;
  onSaveBody: (path: string, body: string) => Promise<void>;
  onSaveProperties: (path: string, summary: string, reviewBy: string | null) => Promise<void>;
  onCreateBrief: (dir: string, name: string, summary: string, createOverview: boolean) => Promise<void>;
  /** A path to open on entry (e.g. when arriving from search). */
  focusPath?: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  briefPath?: string;
}

function buildTree(briefPaths: string[]): TreeNode {
  const root: TreeNode = { name: 'briefs', path: '.lovelace/briefs', children: [] };
  for (const path of briefPaths) {
    if (!path.startsWith('.lovelace/briefs/')) continue;
    const rel = path.slice('.lovelace/briefs/'.length).split('/');
    let node = root;
    for (let i = 0; i < rel.length - 1; i++) {
      const dir = rel[i] ?? '';
      let child = node.children.find((c) => c.name === dir && !c.briefPath);
      if (!child) {
        child = { name: dir, path: `${node.path}/${dir}`, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    const file = rel[rel.length - 1] ?? '';
    node.children.push({ name: file, path, briefPath: path, children: [] });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(!!a.briefPath) - Number(!!b.briefPath) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

function bodyOf(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').replace(/^\n/, '') : content;
}

function directories(node: TreeNode, acc: string[] = []): string[] {
  acc.push(node.path);
  for (const child of node.children) {
    if (!child.briefPath) directories(child, acc);
  }
  return acc;
}

export function Briefs({ snapshot, onSaveBody, onSaveProperties, onCreateBrief, focusPath }: BriefsProps) {
  const host = useHost();
  const briefs = snapshot.index.briefs;
  const [selected, setSelected] = useState<string>(focusPath ?? '.lovelace/CONTEXT.md');
  const [content, setContent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newDir, setNewDir] = useState('.lovelace/briefs');
  const [newName, setNewName] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(briefs.map((b) => b.path)), [briefs]);
  const dirs = useMemo(() => directories(tree), [tree]);
  const selectedBrief = briefs.find((b) => b.path === selected);
  const dirIsNew = !dirs.includes(newDir);
  const stale = (path: string) => {
    const brief = briefs.find((b) => b.path === path);
    return brief?.review_by !== undefined && new Date(brief.review_by).getTime() < Date.now();
  };

  // A new selection loads fresh (and may show the loading state)...
  useEffect(() => {
    setContent(null);
    void host.readFile(snapshot.root, selected).then(
      (text) => setContent(bodyOf(text)),
      () => setContent(''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, snapshot.root, selected]);

  // ...but snapshot refreshes (saves, watcher events) update silently, so
  // the editor never unmounts and de-focusing cannot flash.
  useEffect(() => {
    void host.readFile(snapshot.root, selected).then(
      (text) => {
        const fresh = bodyOf(text);
        setContent((current) => (current !== null && current !== fresh ? fresh : current));
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.index]);

  // Arriving from search: open the requested brief.
  useEffect(() => {
    if (focusPath) setSelected(focusPath);
  }, [focusPath]);

  const toggleDir = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.briefPath) {
      return (
        <button
          key={node.path}
          className={`tree-item${selected === node.briefPath ? ' active' : ''}`}
          style={{ paddingLeft: `${14 + depth * 16}px` }}
          onClick={() => setSelected(node.briefPath!)}
        >
          <FileIcon style={{ color: 'var(--mist)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name.replace(/\.md$/, '')}
          </span>
          {stale(node.briefPath) && <span className="badge-stale">stale</span>}
        </button>
      );
    }
    const isOpen = !collapsed.has(node.path);
    return (
      <div key={node.path}>
        <button
          className="tree-item tree-dir"
          style={{ paddingLeft: `${depth * 16}px` }}
          onClick={() => toggleDir(node.path)}
          aria-expanded={isOpen}
        >
          <CaretIcon className={`tree-caret${isOpen ? ' open' : ''}`} />
          <FolderIcon style={{ color: 'var(--slate)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </button>
        {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Documentation</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <AddIcon />
          New brief
        </button>
      </header>
      {error && <div className="banner">{error}</div>}
      <div className="detail-grid" style={{ gridTemplateColumns: '15rem minmax(0, 1fr)' }}>
        <aside className="glass-card tree" style={{ alignSelf: 'start' }}>
          <button
            className={`tree-item${selected === '.lovelace/CONTEXT.md' ? ' active' : ''}`}
            style={{ paddingLeft: '14px' }}
            onClick={() => setSelected('.lovelace/CONTEXT.md')}
          >
            <FileIcon style={{ color: 'var(--mist)', flexShrink: 0 }} />
            Context
          </button>
          {tree.children.map((c) => renderNode(c, 0))}
        </aside>
        <div>
          {selectedBrief && (
            <div className="props-strip" key={selectedBrief.path}>
              <span className="id-chip">{selectedBrief.id}</span>
              <input
                className="form-input"
                aria-label="brief summary"
                placeholder="One or two sentences; indexes display this."
                style={{ flex: 1 }}
                defaultValue={selectedBrief.summary}
                onBlur={(e) => {
                  if (e.target.value !== selectedBrief.summary) {
                    void onSaveProperties(selected, e.target.value, selectedBrief.review_by ?? null);
                  }
                }}
              />
              <input
                className="form-input mono"
                type="date"
                aria-label="review by"
                style={{ width: '9.5rem', flexShrink: 0 }}
                defaultValue={selectedBrief.review_by ?? ''}
                onBlur={(e) => {
                  const value = e.target.value || null;
                  if (value !== (selectedBrief.review_by ?? null)) {
                    void onSaveProperties(selected, selectedBrief.summary, value);
                  }
                }}
              />
              {stale(selectedBrief.path) && <span className="badge-stale">stale</span>}
            </div>
          )}
          <div className="glass-card" style={{ padding: '12px 0' }}>
            {content === null ? (
              <p className="label">loading...</p>
            ) : (
              <BlockEditor
                source={content}
                onChange={(next) => {
                  setContent(next);
                  void onSaveBody(selected, next).catch((e) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              />
            )}
          </div>
        </div>
      </div>
      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New brief</h2>
            <div className="field-row">
              <span className="label">directory</span>
              <div>
                <Dropdown
                  aria-label="brief directory"
                  mono
                  width="100%"
                  value={dirs.includes(newDir) ? newDir : '__custom__'}
                  options={[
                    ...dirs.map((d) => ({ value: d, label: d.replace('.lovelace/', '') })),
                    { value: '__custom__', label: 'new directory...' },
                  ]}
                  onChange={(v) => {
                    if (v && v !== '__custom__') setNewDir(v);
                    else setNewDir('.lovelace/briefs/');
                  }}
                />
                {!dirs.includes(newDir) && (
                  <input
                    className="form-input mono"
                    aria-label="new directory path"
                    style={{ marginTop: '0.4rem' }}
                    value={newDir}
                    onChange={(e) => setNewDir(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div className="field-row">
              <span className="label">filename</span>
              <input
                className="form-input mono"
                aria-label="brief filename"
                placeholder="caching-strategy"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="field-row">
              <span className="label">summary</span>
              <input
                className="form-input"
                aria-label="new brief summary"
                placeholder="One or two sentences; indexes display this."
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
              />
            </div>
            {dirIsNew && (
              <p className="label" style={{ margin: '0.5rem 0 0' }}>
                New directory: its OVERVIEW.md will be created too.
              </p>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!newName.trim()}
                onClick={() => {
                  void onCreateBrief(newDir, newName.trim(), newSummary.trim() || '(to be written)', dirIsNew)
                    .then(() => {
                      setSelected(`${newDir.replace(/\/$/, '')}/${newName.trim()}.md`);
                      setCreating(false);
                      setNewName('');
                      setNewSummary('');
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
              >
                Create brief
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
