/**
 * The editor's document model. A Markdown body is split into blocks, each
 * keeping its ORIGINAL source text. Serialisation concatenates sources, so
 * a document opened and saved without edits is byte-identical, and an edit
 * touches exactly one block's lines. Round-trip fidelity is structural
 * here, not a serialiser property (see ADR-0002).
 *
 * Block kinds the spec supports render as rich previews and are editable.
 * Anything else is classified raw: rendered verbatim, not editable.
 */

import { matchFenceOpen, isFenceClose } from '../lib/fences';

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code'
  | 'quote'
  | 'table'
  | 'blank'
  | 'raw';

export interface Block {
  kind: BlockKind;
  /** Original source, exactly as read, including inner newlines. */
  source: string;
}

const HEADING_RE = /^#{1,6}\s/;
const LIST_RE = /^\s*([-*+]|\d+\.)\s/;
const QUOTE_RE = /^>/;
const TABLE_RE = /^\|.*\|\s*$/;
const HTML_RE = /^</;

export function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const take = (kind: BlockKind, from: number, to: number) => {
    blocks.push({ kind, source: lines.slice(from, to).join('\n') });
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      let end = i;
      while (end < lines.length && (lines[end] ?? '').trim() === '') end += 1;
      // The final empty string from a trailing newline split stays attached
      // to the blank block so concatenation reproduces it exactly.
      take('blank', i, end);
      i = end;
      continue;
    }
    const fenceOpen = matchFenceOpen(line);
    if (fenceOpen) {
      let end = i + 1;
      // Close must use the same fence character with length >= opener length.
      while (end < lines.length && !isFenceClose(lines[end] ?? '', fenceOpen)) end += 1;
      take('code', i, Math.min(end + 1, lines.length));
      i = Math.min(end + 1, lines.length);
      continue;
    }
    if (HEADING_RE.test(line)) {
      take('heading', i, i + 1);
      i += 1;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      let end = i;
      while (end < lines.length && QUOTE_RE.test(lines[end] ?? '')) end += 1;
      take('quote', i, end);
      i = end;
      continue;
    }
    if (TABLE_RE.test(line)) {
      let end = i;
      while (end < lines.length && TABLE_RE.test(lines[end] ?? '')) end += 1;
      take('table', i, end);
      i = end;
      continue;
    }
    if (LIST_RE.test(line)) {
      let end = i;
      while (
        end < lines.length &&
        ((lines[end] ?? '').trim() === '' ? false : LIST_RE.test(lines[end] ?? '') || /^\s{2,}/.test(lines[end] ?? ''))
      ) {
        end += 1;
      }
      take('list', i, end);
      i = end;
      continue;
    }
    if (HTML_RE.test(line)) {
      let end = i;
      while (end < lines.length && (lines[end] ?? '').trim() !== '') end += 1;
      take('raw', i, end);
      i = end;
      continue;
    }
    // Paragraph: consecutive non-empty lines that start nothing else.
    let end = i;
    while (
      end < lines.length &&
      (lines[end] ?? '').trim() !== '' &&
      !matchFenceOpen(lines[end] ?? '') &&
      !HEADING_RE.test(lines[end] ?? '') &&
      !QUOTE_RE.test(lines[end] ?? '') &&
      !TABLE_RE.test(lines[end] ?? '') &&
      !LIST_RE.test(lines[end] ?? '') &&
      !HTML_RE.test(lines[end] ?? '')
    ) {
      end += 1;
    }
    take('paragraph', i, end);
    i = end;
  }

  return blocks;
}

/** Concatenation of original sources; identity when nothing was edited. */
export function serialiseBlocks(blocks: Block[]): string {
  return blocks
    .map((b, idx) => (idx < blocks.length - 1 ? `${b.source}\n` : b.source))
    .join('');
}

export function isEditable(kind: BlockKind): boolean {
  return kind !== 'raw' && kind !== 'blank';
}

/** Replaces one block's source, returning a new array. */
export function editBlock(blocks: Block[], index: number, source: string): Block[] {
  return blocks.map((b, i) => (i === index ? { ...b, source } : b));
}

/** Removes a block (and a neighbouring blank separator when present). */
export function removeBlock(blocks: Block[], index: number): Block[] {
  const out = blocks.filter((_, i) => i !== index);
  if (index < out.length && out[index]?.kind === 'blank' && (index === 0 || out[index - 1]?.kind === 'blank')) {
    out.splice(index, 1);
  }
  return out;
}

/** Inserts a new paragraph block after the given index, with a blank separator. */
export function insertBlockAfter(blocks: Block[], index: number, source = ''): Block[] {
  const out = [...blocks];
  out.splice(index + 1, 0, { kind: 'blank', source: '' }, { kind: 'paragraph', source });
  return out;
}

/* ---------- helpers for in-place rich editing ---------- */

const HEADING_PREFIX_RE = /^(#{1,6})\s+/;

export function headingParts(source: string): { prefix: string; text: string } {
  const match = HEADING_PREFIX_RE.exec(source);
  if (!match) return { prefix: '', text: source };
  return { prefix: `${match[1]} `, text: source.slice(match[0].length) };
}

export interface ListLine {
  /** Marker and indentation, kept verbatim: '- ', '  - [x] ', '3. '. */
  prefix: string;
  text: string;
  task: 'open' | 'done' | null;
}

const LIST_LINE_RE = /^(\s*(?:[-*+]|\d+\.)\s(?:\[([ xX])\]\s)?)(.*)$/;

export function listLines(source: string): ListLine[] {
  return source.split('\n').map((line) => {
    const match = LIST_LINE_RE.exec(line);
    if (!match) return { prefix: '', text: line, task: null };
    const task = match[2] === undefined ? null : match[2] === ' ' ? 'open' : 'done';
    return { prefix: match[1] ?? '', text: match[3] ?? '', task };
  });
}

export function serialiseListLines(lines: ListLine[]): string {
  return lines.map((l) => `${l.prefix}${l.text}`).join('\n');
}

export function toggleTaskLine(line: ListLine): ListLine {
  if (line.task === null) return line;
  const prefix =
    line.task === 'open' ? line.prefix.replace('[ ]', '[x]') : line.prefix.replace(/\[[xX]\]/, '[ ]');
  return { ...line, prefix, task: line.task === 'open' ? 'done' : 'open' };
}

/** A fresh sibling marker for Enter inside a list: same shape, unchecked. */
export function siblingPrefix(prefix: string): string {
  const renumbered = prefix.replace(/\d+\./, (n) => `${Number.parseInt(n, 10) + 1}.`);
  return renumbered.replace(/\[[xX]\]/, '[ ]');
}

export function quoteLines(source: string): string[] {
  return source.split('\n').map((line) => line.replace(/^>\s?/, ''));
}

export function serialiseQuoteLines(lines: string[]): string {
  return lines.map((l) => `> ${l}`.trimEnd()).join('\n');
}

export function codeParts(source: string): { open: string; code: string; close: string } {
  const lines = source.split('\n');
  const openLine = lines[0] ?? '```';
  const last = lines[lines.length - 1] ?? '';
  const openFence = matchFenceOpen(openLine);
  const hasClose = lines.length > 1 && openFence !== null && isFenceClose(last, openFence);
  return {
    open: openLine,
    code: lines.slice(1, hasClose ? -1 : undefined).join('\n'),
    close: hasClose ? last : openLine.startsWith('~~~') ? '~~~' : '```',
  };
}

/** Splits one block into two paragraphs at a caret position. */
export function splitBlock(blocks: Block[], index: number, before: string, after: string): Block[] {
  const out = [...blocks];
  const replacement: Block[] = [
    { kind: blocks[index]?.kind === 'heading' && before.length > 0 ? 'heading' : 'paragraph', source: before },
    { kind: 'blank', source: '' },
    { kind: 'paragraph', source: after },
  ];
  out.splice(index, 1, ...replacement);
  return out;
}
