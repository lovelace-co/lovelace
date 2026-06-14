import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import type { JSX } from 'react';

type SerializedVerbatimNode = Spread<{ source: string }, SerializedLexicalNode>;

/**
 * A block the editor must never touch: tables and out-of-spec raw
 * markdown ride through editing sessions as this read-only node, and
 * export their original source byte-for-byte.
 */
export class VerbatimNode extends DecoratorNode<JSX.Element> {
  __source: string;

  static getType(): string {
    return 'verbatim';
  }

  static clone(node: VerbatimNode): VerbatimNode {
    return new VerbatimNode(node.__source, node.__key);
  }

  static importJSON(serialized: SerializedVerbatimNode): VerbatimNode {
    return new VerbatimNode(serialized.source);
  }

  constructor(source: string, key?: NodeKey) {
    super(key);
    this.__source = source;
  }

  exportJSON(): SerializedVerbatimNode {
    return { type: 'verbatim', version: 1, source: this.__source };
  }

  getSource(): string {
    return this.__source;
  }

  createDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'le-verbatim';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <pre className="block-raw-pre" title="Preserved verbatim; edited in the file">
        {this.__source}
      </pre>
    );
  }
}

export function $createVerbatimNode(source: string): VerbatimNode {
  return new VerbatimNode(source);
}

export function $isVerbatimNode(node: unknown): node is VerbatimNode {
  return node instanceof VerbatimNode;
}
