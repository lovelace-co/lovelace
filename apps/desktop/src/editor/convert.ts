import { CodeNode } from '@lexical/code';
import { createHeadlessEditor } from '@lexical/headless';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { parseBlocks, type Block } from './blocks';
import { $createVerbatimNode, $isVerbatimNode, VerbatimNode } from './VerbatimNode';
import { $createWikiLinkNode, $isWikiLinkNode, WikiLinkNode } from './WikiLinkNode';

/**
 * Markdown <-> Lexical, with two guarantees layered on top of
 * @lexical/markdown:
 *
 * 1. Verbatim protection. Blocks outside the editable subset (tables,
 *    raw HTML) are swapped for sentinel lines before conversion and
 *    become VerbatimNodes, exporting their original bytes untouched.
 * 2. Byte reuse. After export, every block whose normal form matches an
 *    original block (in order) re-emits the original's exact bytes, so
 *    diffs touch only what the user actually edited.
 */

export const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  VerbatimNode,
  WikiLinkNode,
];

const SENTINEL = '⁣LOVELACE-VERBATIM-';

function verbatimTransformer(sources: string[]): ElementTransformer {
  return {
    type: 'element',
    dependencies: [VerbatimNode],
    regExp: new RegExp(`^${SENTINEL}(\\d+)⁣$`),
    replace: (parentNode, _children, match) => {
      const index = Number.parseInt(match[1] ?? '0', 10);
      parentNode.replace($createVerbatimNode(sources[index] ?? ''));
    },
    export: (node) => ($isVerbatimNode(node) ? node.getSource() : null),
  };
}

/**
 * A wiki-link `[[id]]`: stored as the stable id, rendered as an inline node.
 * `importRegExp` catches links when a file is loaded; `regExp` (end-anchored,
 * fired on the closing bracket) converts one typed in place. Export returns the
 * exact `[[id]]` so the source token never drifts.
 */
const WIKILINK: TextMatchTransformer = {
  dependencies: [WikiLinkNode],
  export: (node) => ($isWikiLinkNode(node) ? `[[${node.getId()}]]` : null),
  importRegExp: /\[\[([^\]\n]+)\]\]/,
  regExp: /\[\[([^\]\n]+)\]\]$/,
  replace: (textNode, match) => {
    textNode.replace($createWikiLinkNode((match[1] ?? '').trim()));
  },
  trigger: ']',
  type: 'text-match',
};

/** CHECK_LIST must outrank the bullet transformer or `- [ ]` reads as a bullet. */
const BASE_TRANSFORMERS: Transformer[] = [CHECK_LIST, WIKILINK, ...TRANSFORMERS];

export function buildTransformers(sources: string[]): Transformer[] {
  return [verbatimTransformer(sources), ...BASE_TRANSFORMERS];
}

export interface PreparedMarkdown {
  markdown: string;
  sources: string[];
}

/** Swaps unsupported blocks for sentinels ahead of conversion. */
export function prepareMarkdown(source: string): PreparedMarkdown {
  const blocks = parseBlocks(source).filter((b) => b.kind !== 'blank');
  const sources: string[] = [];
  const chunks = blocks.map((block) => {
    if (block.kind === 'table' || block.kind === 'raw') {
      sources.push(block.source);
      return `${SENTINEL}${sources.length - 1}⁣`;
    }
    return block.source;
  });
  return { markdown: chunks.join('\n\n'), sources };
}

/* ---------- the byte-reuse reconciler ---------- */

let headless: ReturnType<typeof createHeadlessEditor> | null = null;

function getHeadless() {
  if (!headless) {
    headless = createHeadlessEditor({ nodes: EDITOR_NODES, onError: () => undefined });
  }
  return headless;
}

/** Lexical's normal form of a markdown fragment, computed off-screen. */
export function normalFormOf(markdown: string): string {
  const editor = getHeadless();
  let out = '';
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, BASE_TRANSFORMERS);
    },
    { discrete: true },
  );
  editor.read(() => {
    out = $convertToMarkdownString(BASE_TRANSFORMERS);
  });
  return out.trim();
}

function meaningful(source: string): Block[] {
  return parseBlocks(source).filter((b) => b.kind !== 'blank');
}

/**
 * Re-emits original bytes for every unedited block. New blocks keep the
 * editor's normal form; verbatim blocks are byte-equal by construction.
 */
export function reconcile(originalSource: string, editedMarkdown: string): string {
  const oldBlocks = meaningful(originalSource);
  const newBlocks = meaningful(editedMarkdown);
  const oldNormals = oldBlocks.map((b) =>
    b.kind === 'table' || b.kind === 'raw' ? b.source : normalFormOf(b.source),
  );

  let cursor = 0;
  const result: string[] = [];
  for (const block of newBlocks) {
    let matched = -1;
    for (let i = cursor; i < oldBlocks.length; i++) {
      if (oldNormals[i] === block.source) {
        matched = i;
        break;
      }
    }
    if (matched !== -1) {
      result.push(oldBlocks[matched]!.source);
      cursor = matched + 1;
    } else {
      result.push(block.source);
    }
  }
  return result.length === 0 ? '' : `${result.join('\n\n')}\n`;
}
