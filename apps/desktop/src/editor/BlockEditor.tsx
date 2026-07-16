import { $createCodeNode } from '@lexical/code';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from '../components/Dropdown';
import { DocsIcon, FileIcon, TicketIcon } from '../components/icons';
import { ReferencePicker } from '../components/ReferencePicker';
import type { LinkResolver, OpenLink, ReferenceCandidate } from '../lib/links';
import { buildTransformers, EDITOR_NODES, prepareMarkdown, reconcile } from './convert';
import { DragHandlePlugin } from './DragHandlePlugin';
import { insertMermaid } from './MermaidNode';
import { MermaidModalPlugin } from './MermaidModalPlugin';
import { SlashMenuPlugin } from './SlashMenu';
import { $createWikiLinkNode, WikiLinkContext, type WikiLinkController } from './WikiLinkNode';

interface BlockEditorProps {
  source: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  /** Insertable references (tickets, documents, files) for the `/` menu and toolbar. */
  candidates?: ReferenceCandidate[];
  /** Resolves a `[[token]]` to a current target for rendering a reference chip. */
  resolveLink?: LinkResolver;
  /** Opens a clicked reference. */
  onOpenLink?: OpenLink;
  /** Test hook: receives the editor instance once mounted. */
  onReady?: (editor: LexicalEditor) => void;
}

const THEME = {
  paragraph: 'le-p',
  heading: { h1: 'le-h1', h2: 'le-h2', h3: 'le-h3', h4: 'le-h4', h5: 'le-h5', h6: 'le-h6' },
  quote: 'le-quote',
  list: {
    ul: 'le-ul',
    ol: 'le-ol',
    listitem: 'le-li',
    listitemChecked: 'le-li-checked',
    listitemUnchecked: 'le-li-unchecked',
    nested: { listitem: 'le-li-nested' },
  },
  code: 'le-code',
  link: 'le-link',
  text: {
    bold: 'le-bold',
    italic: 'le-italic',
    code: 'le-inline-code',
  },
};

/**
 * The Lexical editor on the source-preserving model: playground-style
 * toolbar, inline Notion editing, markdown shortcuts, and the byte-reuse
 * reconciler keeping unedited blocks byte-identical on save.
 */
export function BlockEditor({
  source,
  onChange,
  readOnly = false,
  candidates,
  resolveLink,
  onOpenLink,
  onReady,
}: BlockEditorProps) {
  const prepared = useMemo(() => prepareMarkdown(source), [source]);
  const transformers = useMemo(() => buildTransformers(prepared.sources), [prepared.sources]);
  const lastEmitted = useRef<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const wikiController = useMemo<WikiLinkController>(
    () => ({ resolve: resolveLink ?? (() => null), onOpen: onOpenLink ?? (() => undefined) }),
    [resolveLink, onOpenLink],
  );

  const initialConfig = {
    namespace: 'lovelace',
    theme: THEME,
    editable: !readOnly,
    nodes: EDITOR_NODES,
    onError: (e: Error) => {
      throw e;
    },
    editorState: () => {
      $convertFromMarkdownString(prepared.markdown, transformers);
    },
  };

  const flush = useCallback(
    (editor: LexicalEditor) => {
      editor.read(() => {
        const markdown = $convertToMarkdownString(transformers);
        const next = reconcile(source, markdown);
        if (next !== source && next !== lastEmitted.current) {
          lastEmitted.current = next;
          onChange(next);
        }
      });
    },
    [transformers, source, onChange],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <WikiLinkContext.Provider value={wikiController}>
        <div className={`lexical-shell${readOnly ? ' read-only' : ''}`} data-testid="block-editor">
          {!readOnly && <Toolbar candidates={candidates} />}
          <div className="lexical-scroller" ref={(el) => setAnchorElem(el)}>
            <RichTextPlugin
              contentEditable={<ContentEditable className="lexical-content" aria-label="document body" />}
              placeholder={<div className="lexical-placeholder">Type, or press / for blocks</div>}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          {!readOnly && <SlashMenuPlugin candidates={candidates} />}
          {!readOnly && <DragHandlePlugin anchorElem={anchorElem} />}
          {!readOnly && <MermaidModalPlugin />}
          <HistoryPlugin />
          <ListPlugin />
          <CheckListPlugin />
          <LinkPlugin />
          <TabIndentationPlugin />
          <MarkdownShortcutPlugin transformers={transformers} />
          <OnChangePlugin
            ignoreSelectionChange
            onChange={(_state, editor) => {
              if (readOnly) return;
              if (idle.current) clearTimeout(idle.current);
              idle.current = setTimeout(() => flush(editor), 600);
            }}
          />
          <SyncPlugin source={source} prepared={prepared.markdown} transformers={transformers} lastEmitted={lastEmitted} flush={flush} onReady={onReady} />
        </div>
      </WikiLinkContext.Provider>
    </LexicalComposer>
  );
}

/** Reloads the editor when the file changes underneath it, and flushes on blur. */
function SyncPlugin({
  source,
  prepared,
  transformers,
  lastEmitted,
  flush,
  onReady,
}: {
  source: string;
  prepared: string;
  transformers: ReturnType<typeof buildTransformers>;
  lastEmitted: { current: string | null };
  flush: (editor: LexicalEditor) => void;
  onReady?: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const loaded = useRef(source);

  useEffect(() => {
    onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (source === loaded.current || source === lastEmitted.current) {
      loaded.current = source;
      return;
    }
    // External change (an agent wrote the file): reload the document.
    loaded.current = source;
    editor.update(() => {
      $convertFromMarkdownString(prepared, transformers);
    });
  }, [source, prepared, transformers, editor, lastEmitted]);

  useEffect(() => {
    return editor.registerRootListener((root, prevRoot) => {
      const onBlur = () => flush(editor);
      prevRoot?.removeEventListener('blur', onBlur);
      root?.addEventListener('blur', onBlur);
    });
  }, [editor, flush]);

  return null;
}

const BLOCK_OPTIONS = [
  ['paragraph', 'Text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['bullet', 'Bulleted list'],
  ['number', 'Numbered list'],
  ['check', 'Task list'],
  ['quote', 'Quote'],
  ['code', 'Code block'],
  ['diagram', 'Diagram'],
] as const;

type BlockType = (typeof BLOCK_OPTIONS)[number][0];

function Toolbar({ candidates = [] }: { candidates?: ReferenceCandidate[] }) {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>('paragraph');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [code, setCode] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [picker, setPicker] = useState<'ticket' | 'document' | 'file' | null>(null);

  /** Insert a reference chip at the current selection (retained across the picker). */
  const insertReference = (token: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const node = $createWikiLinkNode(token);
      selection.insertNodes([node]);
      const space = $createTextNode(' ');
      node.insertAfter(space);
      space.select(1, 1);
    });
    setPicker(null);
  };

  const refresh = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setBold(selection.hasFormat('bold'));
    setItalic(selection.hasFormat('italic'));
    setCode(selection.hasFormat('code'));
    const anchor = selection.anchor.getNode();
    const element = anchor.getKey() === 'root' ? anchor : ($findMatchingParent(anchor, (n) => n.getParent()?.getKey() === 'root') ?? anchor.getTopLevelElementOrThrow());
    const type = element.getType();
    if ($isHeadingNode(element)) setBlockType(element.getTag() as BlockType);
    else if (type === 'quote') setBlockType('quote');
    else if (type === 'code') setBlockType('code');
    else if (type === 'list') {
      const tag = (element as unknown as { getListType: () => string }).getListType();
      setBlockType(tag === 'bullet' ? 'bullet' : tag === 'check' ? 'check' : 'number');
    } else setBlockType('paragraph');
  }, []);

  useEffect(() => {
    const offSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        refresh();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const offUndo = editor.registerCommand(CAN_UNDO_COMMAND, (v: boolean) => (setCanUndo(v), false), COMMAND_PRIORITY_LOW);
    const offRedo = editor.registerCommand(CAN_REDO_COMMAND, (v: boolean) => (setCanRedo(v), false), COMMAND_PRIORITY_LOW);
    return () => {
      offSelection();
      offUndo();
      offRedo();
    };
  }, [editor, refresh]);

  const setBlock = (type: BlockType) => {
    if (type === 'bullet') return editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    if (type === 'number') return editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    if (type === 'check') return editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
    // A diagram is a decorator, not an element block: $setBlocksType cannot
    // convert into it, so insert a fresh mermaid block instead.
    if (type === 'diagram') return insertMermaid(editor);
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (type === 'paragraph') $setBlocksType(selection, () => $createParagraphNode());
      else if (type === 'quote') $setBlocksType(selection, () => $createQuoteNode());
      else if (type === 'code') $setBlocksType(selection, () => $createCodeNode());
      else $setBlocksType(selection, () => $createHeadingNode(type));
    });
  };

  const pickerTitle =
    picker === 'ticket' ? 'Link a ticket' : picker === 'document' ? 'Link a document' : 'Link a file';

  return (
    <div className="lexical-toolbar" role="toolbar" aria-label="formatting">
      <button className="tool" disabled={!canUndo} aria-label="undo" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>
        ↺
      </button>
      <button className="tool" disabled={!canRedo} aria-label="redo" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>
        ↻
      </button>
      <Dropdown
        aria-label="block type"
        value={blockType}
        placeholder="Text"
        options={BLOCK_OPTIONS.map(([value, label]) => ({ value, label }))}
        onChange={(v) => v && setBlock(v as BlockType)}
      />
      <button
        className={`tool${bold ? ' on' : ''}`}
        aria-label="bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        B
      </button>
      <button
        className={`tool tool-i${italic ? ' on' : ''}`}
        aria-label="italic"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        I
      </button>
      <button
        className={`tool mono${code ? ' on' : ''}`}
        aria-label="inline code"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
      >
        {'<>'}
      </button>
      <button
        className="tool"
        aria-label="link"
        onClick={() => {
          const url = window.prompt('Link URL');
          if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        }}
      >
        ∞
      </button>
      <span className="tool-gap" />
      <button className="tool" aria-label="link a ticket" title="Link a ticket" onClick={() => setPicker('ticket')}>
        <TicketIcon />
      </button>
      <button className="tool" aria-label="link a document" title="Link a document" onClick={() => setPicker('document')}>
        <DocsIcon />
      </button>
      <button className="tool" aria-label="link a file" title="Link a file" onClick={() => setPicker('file')}>
        <FileIcon />
      </button>
      {picker && (
        <ReferencePicker
          title={pickerTitle}
          candidates={candidates.filter((c) => c.kind === picker)}
          onPick={insertReference}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export type { BlockEditorProps };
