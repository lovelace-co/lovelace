import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  createCommand,
  DecoratorNode,
  type LexicalEditor,
  type LexicalCommand,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { JSX } from 'react';
import { MermaidDiagram } from '../components/MermaidDiagram';

/** Dispatched to open the (stage 2) source editor for a mermaid block. */
export const OPEN_MERMAID_MODAL_COMMAND: LexicalCommand<{ nodeKey: NodeKey; isNew?: boolean }> =
  createCommand('OPEN_MERMAID_MODAL');

/** A minimal starter diagram, used for both new inserts and the eventual modal default. */
export const MERMAID_STARTER_TEMPLATE = 'flowchart LR\n  A[Start] --> B[Finish]';

type SerializedMermaidNode = Spread<{ source: string }, SerializedLexicalNode>;

function MermaidBlock({ nodeKey, source }: { nodeKey: NodeKey; source: string }) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();

  const open = () => editor.dispatchCommand(OPEN_MERMAID_MODAL_COMMAND, { nodeKey });

  return (
    <div
      className="mermaid-block"
      contentEditable={false}
      {...(editable ? { onClick: open } : {})}
    >
      <MermaidDiagram source={source} />
      {editable && (
        <button
          type="button"
          className="mermaid-block-edit"
          aria-label="Edit diagram"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          Edit diagram
        </button>
      )}
    </div>
  );
}

/**
 * A block Mermaid diagram: stores only the raw diagram source and renders it
 * via MermaidDiagram. Exports back to a clean ```mermaid fence (see the
 * MERMAID transformer in convert.ts) so round-trip fidelity holds.
 */
export class MermaidNode extends DecoratorNode<JSX.Element> {
  __source: string;

  static getType(): string {
    return 'mermaid';
  }

  static clone(node: MermaidNode): MermaidNode {
    return new MermaidNode(node.__source, node.__key);
  }

  static importJSON(serialized: SerializedMermaidNode): MermaidNode {
    return new MermaidNode(serialized.source);
  }

  constructor(source: string, key?: NodeKey) {
    super(key);
    this.__source = source;
  }

  exportJSON(): SerializedMermaidNode {
    return { type: 'mermaid', version: 1, source: this.__source };
  }

  getSource(): string {
    return this.__source;
  }

  setSource(next: string): void {
    const writable = this.getWritable();
    writable.__source = next;
  }

  /** The markdown/plain-text form, so plain-text copy stays a valid fence. */
  getTextContent(): string {
    return `\`\`\`mermaid\n${this.__source}\n\`\`\``;
  }

  createDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'le-mermaid';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return <MermaidBlock nodeKey={this.__key} source={this.__source} />;
  }
}

export function $createMermaidNode(source: string): MermaidNode {
  return new MermaidNode(source);
}

export function $isMermaidNode(node: unknown): node is MermaidNode {
  return node instanceof MermaidNode;
}

/**
 * Inserts a new mermaid block at the current selection: replaces the current
 * top-level element if it is empty, otherwise inserts after it, then leaves a
 * fresh paragraph after the diagram so typing can continue. Dispatches
 * OPEN_MERMAID_MODAL_COMMAND once the node exists so stage 2's modal (not yet
 * wired up) can take over editing the source.
 */
export function insertMermaid(editor: LexicalEditor): void {
  let insertedKey: NodeKey | null = null;
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const node = $createMermaidNode(MERMAID_STARTER_TEMPLATE);
    const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow();
    if (topLevel.getTextContent() === '') {
      topLevel.replace(node);
    } else {
      topLevel.insertAfter(node);
    }
    node.insertAfter($createParagraphNode());
    insertedKey = node.getKey();
  });
  if (insertedKey !== null) {
    editor.dispatchCommand(OPEN_MERMAID_MODAL_COMMAND, { nodeKey: insertedKey, isNew: true });
  }
}
