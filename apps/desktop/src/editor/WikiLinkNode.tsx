import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import { createContext, useContext, type JSX } from 'react';
import type { LinkResolver, OpenLink } from '../lib/links';

/**
 * Supplies the editor's wiki-link nodes with a resolver (id -> current title)
 * and an open handler. Provided by BlockEditor around the composer so each
 * decorator chip resolves and navigates without threading props through Lexical.
 */
export interface WikiLinkController {
  resolve: LinkResolver;
  onOpen: OpenLink;
}

export const WikiLinkContext = createContext<WikiLinkController | null>(null);

function WikiLinkChip({ id }: { id: string }) {
  const controller = useContext(WikiLinkContext);
  const target = controller?.resolve(id) ?? null;
  if (!target) {
    return (
      <span className="wikilink broken" title={`Unresolved link: ${id}`} contentEditable={false}>
        [[{id}]]
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`wikilink ${target.kind}`}
      title={`${target.kind} · ${target.id}`}
      contentEditable={false}
      onClick={(e) => {
        e.preventDefault();
        controller?.onOpen(target);
      }}
    >
      {target.label}
    </button>
  );
}

type SerializedWikiLinkNode = Spread<{ id: string }, SerializedLexicalNode>;

/**
 * An inline wiki-link: stores the stable target id and renders its current
 * title. Exports back to `[[id]]` verbatim (both via the markdown transformer
 * and getTextContent), so the stored token never drifts from the id.
 */
export class WikiLinkNode extends DecoratorNode<JSX.Element> {
  __id: string;

  static getType(): string {
    return 'wikilink';
  }

  static clone(node: WikiLinkNode): WikiLinkNode {
    return new WikiLinkNode(node.__id, node.__key);
  }

  static importJSON(serialized: SerializedWikiLinkNode): WikiLinkNode {
    return new WikiLinkNode(serialized.id);
  }

  constructor(id: string, key?: NodeKey) {
    super(key);
    this.__id = id;
  }

  exportJSON(): SerializedWikiLinkNode {
    return { type: 'wikilink', version: 1, id: this.__id };
  }

  getId(): string {
    return this.__id;
  }

  /** The markdown/plain-text form, so export and copy both yield `[[id]]`. */
  getTextContent(): string {
    return `[[${this.__id}]]`;
  }

  createDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'wikilink-host';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  decorate(): JSX.Element {
    return <WikiLinkChip id={this.__id} />;
  }
}

export function $createWikiLinkNode(id: string): WikiLinkNode {
  return new WikiLinkNode(id);
}

export function $isWikiLinkNode(node: unknown): node is WikiLinkNode {
  return node instanceof WikiLinkNode;
}
