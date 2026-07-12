import { LineCounter, parseDocument } from 'yaml';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  /** 1-based line of each top-level frontmatter key. */
  keyLines: Map<string, number>;
  body: string;
  /** 1-based line on which the body starts. */
  bodyLine: number;
  /** Raw frontmatter text between the delimiters, without them. */
  raw: string;
}

export class FrontmatterError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

/**
 * Splits text into lines on LF, CRLF or bare CR, alongside the character
 * offset each line starts at in the original string. Hand-edited files (and
 * fixtures checked out on Windows) are not guaranteed to be LF; a caller
 * that needs exact bytes back slices the original text at a `starts` offset
 * rather than rejoining this function's line array, which would normalise
 * whatever line ending the source actually used.
 */
function splitLinesWithOffsets(text: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [0];
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      lines.push(text.slice(lineStart, i));
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lineStart = i + 1;
      starts.push(lineStart);
    }
  }
  lines.push(text.slice(lineStart));
  return { lines, starts };
}

/**
 * Splits a Markdown file into YAML frontmatter and body, with line
 * information so validation errors can point at the offending line. Line
 * endings are read tolerantly (LF, CRLF and bare CR all delimit a line the
 * same way), but the body is recovered by slicing the original text at a
 * computed offset rather than rejoining split lines, so a CRLF body comes
 * back with its \r\n intact instead of being silently normalised to \n.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const { lines, starts } = splitLinesWithOffsets(text);
  if (lines[0] !== '---') {
    throw new FrontmatterError('file must start with a --- frontmatter block', 1);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new FrontmatterError('frontmatter block is not closed with ---', 1);
  }
  const raw = lines.slice(1, end).join('\n');
  const lineCounter = new LineCounter();
  const doc = parseDocument(raw, { lineCounter });
  const firstError = doc.errors[0];
  if (firstError) {
    const pos = firstError.linePos?.[0];
    const line = (pos ? pos.line : 1) + 1; // +1 for the opening --- line
    throw new FrontmatterError(firstError.message.split('\n')[0] ?? 'invalid YAML', line);
  }
  const parsed = doc.toJS() as unknown;
  if (parsed === null || parsed === undefined) {
    throw new FrontmatterError('frontmatter is empty', 2);
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterError('frontmatter must be a YAML mapping', 2);
  }
  const keyLines = new Map<string, number>();
  const contents = doc.contents as { items?: unknown[] } | null;
  for (const item of contents?.items ?? []) {
    const key = (item as { key?: unknown }).key;
    if (key && typeof key === 'object' && 'range' in key && Array.isArray(key.range)) {
      const offset = key.range[0] as number;
      const keyText = String((key as { value?: unknown }).value ?? '');
      keyLines.set(keyText, lineCounter.linePos(offset).line + 1);
    }
  }
  // Sliced from the original text, not rejoined from `lines`, so a CRLF
  // body's bytes (including every \r\n) survive untouched.
  const body = end + 1 < starts.length ? text.slice(starts[end + 1]) : '';
  return {
    data: parsed as Record<string, unknown>,
    keyLines,
    body,
    bodyLine: end + 2,
    raw,
  };
}

/** Extracts the text under a `## Heading` section of a Markdown body. */
export function extractSection(body: string, heading: string): string | undefined {
  const lines = body.split('\n');
  const target = `## ${heading}`.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return undefined;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
