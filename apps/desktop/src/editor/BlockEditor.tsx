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
import { buildTransformers, EDITOR_NODES, prepareMarkdown, reconcile } from './convert';
import { DragHandlePlugin } from './DragHandlePlugin';
import { SlashMenuPlugin } from './SlashMenu';

interface BlockEditorProps {
  source: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
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
export function BlockEditor({ source, onChange, readOnly = false, onReady }: BlockEditorProps) {
  const prepared = useMemo(() => prepareMarkdown(source), [source]);
  const transformers = useMemo(() => buildTransformers(prepared.sources), [prepared.sources]);
  const lastEmitted = useRef<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);

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
      <div className={`lexical-shell${readOnly ? ' read-only' : ''}`} data-testid="block-editor">
        {!readOnly && <Toolbar />}
        <RichTextPlugin
          contentEditable={
            <div className="lexical-scroller" ref={(el) => setAnchorElem(el)}>
              <ContentEditable className="lexical-content" aria-label="document body" />
            </div>
          }
          placeholder={<div className="lexical-placeholder">Type, or press / for blocks</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        {!readOnly && <SlashMenuPlugin />}
        {!readOnly && <DragHandlePlugin anchorElem={anchorElem} />}
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
] as const;

type BlockType = (typeof BLOCK_OPTIONS)[number][0];

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>('paragraph');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [code, setCode] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (type === 'paragraph') $setBlocksType(selection, () => $createParagraphNode());
      else if (type === 'quote') $setBlocksType(selection, () => $createQuoteNode());
      else if (type === 'code') $setBlocksType(selection, () => $createCodeNode());
      else $setBlocksType(selection, () => $createHeadingNode(type));
    });
  };

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
    </div>
  );
}

export type { BlockEditorProps };
