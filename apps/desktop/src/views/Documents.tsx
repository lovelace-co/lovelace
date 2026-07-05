import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from '../components/DatePicker';
import { Toast } from '../components/Toast';
import {
  CaretIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  NewFileIcon,
  NewFolderIcon,
  TrashIcon,
} from '../components/icons';
import { BlockEditor } from '../editor/BlockEditor';
import type { LinkResolver, OpenLink, ReferenceCandidate } from '../lib/links';
import { Markdown } from '../lib/markdown';
import { useHost } from '../state/store';
import type { Snapshot } from '../lib/types';

interface DocumentsProps {
  snapshot: Snapshot;
  onSaveBody: (path: string, body: string) => Promise<void>;
  onSaveProperties: (path: string, summary: string, reviewBy: string | null) => Promise<void>;
  onCreateDocument: (dir: string, name: string, summary: string) => Promise<void>;
  onCreateFolder: (dir: string, name: string) => Promise<void>;
  onRenameDocument: (path: string, name: string) => Promise<void>;
  onDeleteDocument: (path: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  /** A path to open on entry (e.g. when arriving from search). */
  focusPath?: string | null;
  /** Wiki-link plumbing for the editor. */
  candidates?: ReferenceCandidate[];
  resolveLink?: LinkResolver;
  onOpenLink?: OpenLink;
}

const DOCS_ROOT = '.lovelace/documentation';
const INDEX_PATH = `${DOCS_ROOT}/index.md`;

/** The document's title is its filename without the extension. */
function titleOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

/** Filenames are unrestricted; we only reject empty names and path separators. */
function badName(name: string): boolean {
  return name === '' || name.includes('/') || name.includes('..');
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  documentPath?: string;
}

function buildTree(documentPaths: string[]): TreeNode {
  const root: TreeNode = { name: '/', path: DOCS_ROOT, children: [] };
  for (const path of documentPaths) {
    if (!path.startsWith(`${DOCS_ROOT}/`)) continue;
    const rel = path.slice(`${DOCS_ROOT}/`.length).split('/');
    let node = root;
    for (let i = 0; i < rel.length - 1; i++) {
      const dir = rel[i] ?? '';
      let child = node.children.find((c) => c.name === dir && !c.documentPath);
      if (!child) {
        child = { name: dir, path: `${node.path}/${dir}`, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    const file = rel[rel.length - 1] ?? '';
    node.children.push({ name: file, path, documentPath: path, children: [] });
  }
  // index.md is a directory's entry point, so it sits at the top; folders come
  // next, then the remaining files, each group sorted by name.
  const rank = (n: TreeNode) => (n.name === 'index.md' ? 0 : n.documentPath ? 2 : 1);
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

function bodyOf(content: string): string {
  const parts = content.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').replace(/^\n/, '') : content;
}

export function Documents({
  snapshot,
  onSaveBody,
  onSaveProperties,
  onCreateDocument,
  onCreateFolder,
  onRenameDocument,
  onDeleteDocument,
  onDeleteFolder,
  focusPath,
  candidates,
  resolveLink,
  onOpenLink,
}: DocumentsProps) {
  const host = useHost();
  const documents = snapshot.index.documents;
  const [selected, setSelected] = useState<string>(focusPath ?? INDEX_PATH);
  const [content, setContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [savingBody, setSavingBody] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The folder a new file is being created in (opens the modal), and the folder
  // an inline new-folder input is open under.
  const [newFileFor, setNewFileFor] = useState<string | null>(null);
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null);
  // The file or folder a delete has been requested for (opens the warning modal).
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'file' | 'folder'; path: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newName, setNewName] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(documents.map((b) => b.path)), [documents]);
  const selectedDocument = documents.find((b) => b.path === selected);
  const stale = (path: string) => {
    const document = documents.find((b) => b.path === path);
    return document?.review_by !== undefined && new Date(document.review_by).getTime() < Date.now();
  };

  // A new selection loads fresh (and may show the loading state)...
  useEffect(() => {
    setContent(null);
    setEditing(false);
    void host.readFile(snapshot.root, selected).then(
      (text) => setContent(bodyOf(text)),
      () => setContent(''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, snapshot.root, selected]);

  // ...but snapshot refreshes (saves, watcher events) update the rendered view
  // silently. While editing we hold the disk copy back so an incoming refresh
  // (including our own save's round-trip) never disturbs the draft or cursor.
  useEffect(() => {
    if (editing) return;
    void host.readFile(snapshot.root, selected).then(
      (text) => {
        const fresh = bodyOf(text);
        setContent((current) => (current !== null && current !== fresh ? fresh : current));
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.index]);

  // Arriving from search: open the requested document.
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

  const expand = (path: string) =>
    setCollapsed((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });

  const startNewFolder = (dir: string) => {
    expand(dir);
    setNewFileFor(null);
    setNewFolderName('');
    setError(null);
    setNewFolderFor(dir);
  };

  const startNewFile = (dir: string) => {
    setNewFolderFor(null);
    setNewName('');
    setNewSummary('');
    setError(null);
    setNewFileFor(dir);
  };

  const submitNewFolder = () => {
    const dir = newFolderFor;
    const name = newFolderName.trim();
    if (!dir) return;
    if (badName(name)) {
      setError('Folder names cannot be empty or contain a slash.');
      return;
    }
    void onCreateFolder(dir, name)
      .then(() => {
        setNewFolderFor(null);
        setNewFolderName('');
        setError(null);
        setSelected(`${dir}/${name}/index.md`);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const submitNewFile = () => {
    const dir = newFileFor;
    const name = newName.trim();
    if (!dir || !name) return;
    void onCreateDocument(dir, name, newSummary.trim() || '(to be written)')
      .then(() => {
        setSelected(`${dir}/${name}.md`);
        setNewFileFor(null);
        setNewName('');
        setNewSummary('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    const gone = target.kind === 'folder' ? selected.startsWith(`${target.path}/`) : selected === target.path;
    void (target.kind === 'folder' ? onDeleteFolder(target.path) : onDeleteDocument(target.path))
      .then(() => {
        setError(null);
        if (gone) setSelected(INDEX_PATH);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  // The body is view-only until Edit is pressed; editing works on a local
  // draft, and Save writes once and returns to the rendered view. This mirrors
  // the ticket body, so a save never re-syncs the editor or moves the cursor.
  const startEdit = () => {
    setBodyDraft(content ?? '');
    setEditing(true);
  };

  const saveBody = async () => {
    setSavingBody(true);
    setError(null);
    try {
      await onSaveBody(selected, bodyDraft);
      setContent(bodyDraft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBody(false);
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.documentPath) {
      const title = node.name.replace(/\.md$/, '');
      return (
        <div key={node.path} className="tree-dir-row">
          <button
            className={`tree-item${selected === node.documentPath ? ' active' : ''}`}
            style={{ paddingLeft: `${14 + depth * 16}px` }}
            onClick={() => setSelected(node.documentPath!)}
          >
            <FileIcon style={{ color: 'var(--mist)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {stale(node.documentPath) && <span className="badge-stale">stale</span>}
          </button>
          <span className="tree-actions">
            <button
              className="tree-action"
              aria-label={`delete document ${title}`}
              title="Delete document"
              onClick={() => setDeleteTarget({ kind: 'file', path: node.documentPath! })}
            >
              <TrashIcon />
            </button>
          </span>
        </div>
      );
    }
    const isOpen = !collapsed.has(node.path);
    const label = node.name;
    return (
      <div key={node.path}>
        <div className="tree-dir-row">
          <button
            className="tree-item tree-dir"
            style={{ paddingLeft: `${depth * 16}px` }}
            onClick={() => toggleDir(node.path)}
            aria-expanded={isOpen}
          >
            <CaretIcon className={`tree-caret${isOpen ? ' open' : ''}`} />
            <FolderIcon style={{ color: 'var(--slate)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </button>
          <span className="tree-actions">
            <button
              className="tree-action"
              aria-label={`new folder in ${label}`}
              title="New folder"
              onClick={() => startNewFolder(node.path)}
            >
              <NewFolderIcon />
            </button>
            <button
              className="tree-action"
              aria-label={`new file in ${label}`}
              title="New file"
              onClick={() => startNewFile(node.path)}
            >
              <NewFileIcon />
            </button>
            {node.path !== DOCS_ROOT && (
              <button
                className="tree-action"
                aria-label={`delete folder ${label}`}
                title="Delete folder"
                onClick={() => setDeleteTarget({ kind: 'folder', path: node.path })}
              >
                <TrashIcon />
              </button>
            )}
          </span>
        </div>
        {newFolderFor === node.path && (
          <div className="tree-new-row" style={{ paddingLeft: `${(depth + 1) * 16 + 14}px` }}>
            <FolderIcon style={{ color: 'var(--slate)', flexShrink: 0 }} />
            <input
              className="tree-new-input mono"
              autoFocus
              aria-label="new folder name"
              placeholder="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewFolder();
                else if (e.key === 'Escape') setNewFolderFor(null);
              }}
              onBlur={() => {
                if (!newFolderName.trim()) setNewFolderFor(null);
              }}
            />
          </div>
        )}
        {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <header className="view-header">
        <h1 className="view-title">Documentation</h1>
      </header>
      {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
      <div className="detail-grid" style={{ gridTemplateColumns: '15rem minmax(0, 1fr)' }}>
        <aside className="panel tree" style={{ alignSelf: 'start' }}>{renderNode(tree, 0)}</aside>
        <div>
          <div className="doc-head">
            <input
              key={selected}
              className="doc-title"
              aria-label="document filename"
              spellCheck={false}
              defaultValue={titleOf(selected)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const current = titleOf(selected);
                const next = e.target.value.trim().replace(/\.md$/, '');
                if (next === current) {
                  e.target.value = current;
                  return;
                }
                if (badName(next)) {
                  setError('Document filenames cannot be empty or contain a slash.');
                  e.target.value = current;
                  return;
                }
                const input = e.target;
                const dest = `${selected.slice(0, selected.length - `${current}.md`.length)}${next}.md`;
                void onRenameDocument(selected, next)
                  .then(() => {
                    setError(null);
                    setSelected(dest);
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    input.value = current;
                  });
              }}
            />
          </div>
          <div className="panel" style={{ padding: '16px 18px 18px' }}>
            {content === null ? (
              <p className="label body-prose">loading...</p>
            ) : editing ? (
              <div
                className="body-editor"
                onKeyDownCapture={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void saveBody();
                  }
                }}
              >
                <BlockEditor
                  source={bodyDraft}
                  onChange={setBodyDraft}
                  candidates={candidates}
                  resolveLink={resolveLink}
                  onOpenLink={onOpenLink}
                />
                <div className="comment-actions">
                  <button type="button" className="btn btn-danger" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingBody}
                    onClick={() => void saveBody()}
                  >
                    {savingBody ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {content.trim() === '' ? (
                  <p className="subtle body-prose">This document is empty.</p>
                ) : (
                  <div className="body-prose">
                    <Markdown source={content} resolveLink={resolveLink} onOpenLink={onOpenLink} />
                  </div>
                )}
                <div className="comment-compose body-edit-bar">
                  <button type="button" className="btn btn-primary comment-add" onClick={startEdit}>
                    <EditIcon />
                    Edit
                  </button>
                </div>
              </>
            )}
          </div>
          {selectedDocument && (
            <section className="doc-details" key={selectedDocument.path}>
              <div className="doc-details-grid">
                <div className="doc-field">
                  <label className="doc-field-name" htmlFor="doc-summary">
                    Summary
                  </label>
                  <textarea
                    id="doc-summary"
                    className="form-textarea doc-summary"
                    aria-label="document summary"
                    placeholder="One or two sentences on what this document covers."
                    defaultValue={selectedDocument.summary}
                    onBlur={(e) => {
                      if (e.target.value !== selectedDocument.summary) {
                        void onSaveProperties(selected, e.target.value, selectedDocument.review_by ?? null);
                      }
                    }}
                  />
                  <p className="doc-field-hint">Shown in lists; agents read it before opening the document.</p>
                </div>
                <div className="doc-field doc-field-review">
                  <span className="doc-field-name">
                    Review by
                    {stale(selectedDocument.path) && <span className="badge-stale">stale</span>}
                  </span>
                  <DatePicker
                    aria-label="review by"
                    placeholder="No review date"
                    width="100%"
                    value={selectedDocument.review_by ?? null}
                    onChange={(value) => {
                      if (value !== (selectedDocument.review_by ?? null)) {
                        void onSaveProperties(selected, selectedDocument.summary, value);
                      }
                    }}
                  />
                  <p className="doc-field-hint">Flagged stale after this date, to prompt a re-read.</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      {newFileFor !== null && (
        <div className="modal-backdrop" onClick={() => setNewFileFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New document</h2>
            <p className="subtle" style={{ margin: '0 0 0.4rem' }}>
              in <span className="mono">{newFileFor.replace('.lovelace/', '')}</span>
            </p>
            <div className="field-row">
              <span className="label">filename</span>
              <input
                className="form-input mono"
                aria-label="new document filename"
                placeholder="caching-strategy"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) submitNewFile();
                }}
              />
            </div>
            <div className="field-row">
              <span className="label">summary</span>
              <input
                className="form-input"
                aria-label="new document summary"
                placeholder="One or two sentences; indexes display this."
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setNewFileFor(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!newName.trim()} onClick={submitNewFile}>
                Create document
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{deleteTarget.kind === 'folder' ? 'Delete this folder?' : 'Delete this document?'}</h2>
            <p style={{ color: 'var(--slate)', fontSize: '0.8125rem' }}>
              <span className="mono">{deleteTarget.path.replace('.lovelace/', '')}</span>
            </p>
            {(() => {
              const inside =
                deleteTarget.kind === 'folder'
                  ? documents.filter((b) => b.path.startsWith(`${deleteTarget.path}/`)).length
                  : 0;
              return (
                <p style={{ color: 'var(--bad-fg)', fontSize: '0.8125rem' }}>
                  {deleteTarget.kind === 'folder'
                    ? `This permanently deletes the folder${
                        inside > 0 ? ` and the ${inside === 1 ? 'document' : `${inside} documents`} inside it` : ''
                      }. It cannot be undone.`
                    : 'This permanently deletes the document. It cannot be undone.'}
                </p>
              );
            })()}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}>
                {deleteTarget.kind === 'folder' ? 'Delete folder' : 'Delete document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
