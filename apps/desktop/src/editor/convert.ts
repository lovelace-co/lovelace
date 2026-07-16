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
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { parseBlocks, type Block } from './blocks';
import { $createMermaidNode, $isMermaidNode, MermaidNode } from './MermaidNode';
import { $createVerbatimNode, $isVerbatimNode, VerbatimNode } from './VerbatimNode';
import { $createWikiLinkNode, $isWikiLinkNode, WikiLinkNode } from './WikiLinkNode';
import { normalizeEscapedFences, collapseNestedMermaidFences, isMermaidFence } from '../lib/fences';

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
  MermaidNode,
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

/**
 * A ```mermaid fence (and heuristic generic/empty-lang fences whose body
 * looks like a diagram, matching isMermaidFence) imports as a MermaidNode
 * instead of a CodeNode. `regExpEnd` is required (not optional), which also
 * keeps this transformer out of the typing-shortcut path: a typed ```mermaid
 * still makes a CodeNode, and only a full import re-parses it as a diagram.
 *
 * `regExpStart` matches exactly three backticks (the negative lookahead
 * excludes a fourth). The built-in CODE transformer is fence-length-aware:
 * it records the opener's exact backtick run and reuses it on export, so a
 * 4+-backtick fence round-trips correctly through CODE regardless of what
 * bare ``` lines appear in its body. Matching those here too would close at
 * the first such line, corrupting otherwise-legal CommonMark on a zero-edit
 * save. A 4+-backtick ```mermaid fence therefore stays a CodeNode in the live
 * editor (rare in practice; usually the author is quoting a fence, where a
 * code block is the right rendering anyway); read mode still renders it as a
 * diagram regardless of fence length.
 */
const MERMAID: MultilineElementTransformer = {
  type: 'multiline-element',
  dependencies: [MermaidNode],
  regExpStart: /^[ \t]*```(?!`)([\w-]*)[ \t]*$/,
  regExpEnd: /^[ \t]*`{3,}[ \t]*$/,
  export: (node) => ($isMermaidNode(node) ? `\`\`\`mermaid\n${node.getSource()}\n\`\`\`` : null),
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween, isImport) => {
    if (!isImport || children !== null || linesInBetween === null) return false;
    // The default multiline importer includes the empty remainders of the
    // fence lines themselves (regExpStart/regExpEnd are full-line-anchored);
    // drop exactly one from each end, never more, so a diagram body that
    // legitimately starts or ends with a blank line keeps every byte.
    const body = [...linesInBetween];
    if (body[0] === '') body.shift();
    if (body[body.length - 1] === '') body.pop();
    const source = body.join('\n');
    if (!isMermaidFence(startMatch[1] ?? '', source)) return false;
    rootNode.append($createMermaidNode(source));
  },
};

/**
 * CHECK_LIST must outrank the bullet transformer or `- [ ]` reads as a bullet.
 * MERMAID must come before the built-in TRANSFORMERS so it outranks CODE; a
 * `replace` returning false falls through to CODE for non-mermaid fences.
 */
const BASE_TRANSFORMERS: Transformer[] = [CHECK_LIST, WIKILINK, MERMAID, ...TRANSFORMERS];

export function buildTransformers(sources: string[]): Transformer[] {
  return [verbatimTransformer(sources), ...BASE_TRANSFORMERS];
}

export interface PreparedMarkdown {
  markdown: string;
  sources: string[];
}

/** Swaps unsupported blocks for sentinels ahead of conversion. */
export function prepareMarkdown(source: string): PreparedMarkdown {
  // Recover fences Lexical escaped when the user pasted Markdown into a
  // paragraph, so they land as CodeNodes (with language) instead of text.
  // Then collapse any outer shell wrapping an inner ```mermaid fence so
  // Lexical imports a clean CodeNode with lang mermaid on the next edit.
  const normalised = collapseNestedMermaidFences(normalizeEscapedFences(source));
  const blocks = parseBlocks(normalised).filter((b) => b.kind !== 'blank');
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
