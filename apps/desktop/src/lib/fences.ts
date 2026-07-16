const MERMAID_STARTERS =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|sankey-beta|xychart-beta|block-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;

/** Language tags that carry no type information and may hide a Mermaid diagram. */
const GENERIC_LANGS = new Set(['', 'text', 'txt', 'plain']);

/**
 * Returns true when a fenced code block should be treated as a Mermaid diagram.
 * Matches explicit `mermaid` tags (any case) and generic/empty tags whose first
 * non-empty body line begins with a recognised Mermaid diagram type keyword.
 */
export function isMermaidFence(lang: string, body: string): boolean {
  const normalLang = lang.toLowerCase().trim();
  if (normalLang === 'mermaid') return true;
  if (!GENERIC_LANGS.has(normalLang)) return false;
  const firstLine = body.split('\n').find((l) => l.trim() !== '') ?? '';
  return MERMAID_STARTERS.test(firstLine.trim());
}

/**
 * Lexical's markdown export escapes literal backticks in paragraph text as
 * \` so a pasted fence becomes \`\`\`mermaid on disk. That form is not a
 * Markdown fence, so Mermaid never runs. Rewrite those line-level escapes
 * back into real fences when the three escaped backticks stand alone as a
 * fence opener/closer (with an optional language tag).
 */
export function normalizeEscapedFences(source: string): string {
  // Match a line that is only \`\`\` or \`\`\`lang (optional trailing spaces).
  // Groups: leading newline-or-start, then three times backslash-backtick, lang, EOL.
  return source.replace(/(^|\n)(?:\\`){3}([\w-]*)[ \t]*(?=\n|$)/g, '$1```$2');
}

/**
 * Describes the opening marker of a CommonMark fenced code block.
 * Carries the fence character, its length, and the info string (lang tag).
 */
export interface FenceOpen {
  char: '`' | '~';
  length: number;
  lang: string;
}

/**
 * Matches an opening fence line per CommonMark rules. Returns null when the
 * line is not a valid fence opener.
 *
 * A valid opener is 3 or more identical backticks or tildes, followed by an
 * optional info string containing only word characters and hyphens, and
 * optional trailing spaces or tabs. Backtick fences must not have backticks
 * in the info string.
 */
export function matchFenceOpen(line: string): FenceOpen | null {
  // Backtick fences: info string is word characters and hyphens only.
  const btMatch = /^(`{3,})([\w-]*)[ \t]*$/.exec(line);
  if (btMatch) {
    return { char: '`', length: (btMatch[1] ?? '').length, lang: (btMatch[2] ?? '').trim() };
  }
  // Tilde fences: same shape.
  const tildeMatch = /^(~{3,})([\w-]*)[ \t]*$/.exec(line);
  if (tildeMatch) {
    return { char: '~', length: (tildeMatch[1] ?? '').length, lang: (tildeMatch[2] ?? '').trim() };
  }
  return null;
}

/**
 * Returns true when `line` is a valid closing marker for a fence opened with
 * `open`. Per CommonMark: the line must contain only the same fence character
 * as the opener, with length >= opener length, and no info string.
 */
export function isFenceClose(line: string, open: FenceOpen): boolean {
  if (open.char === '`') {
    const m = /^(`{3,})[ \t]*$/.exec(line);
    return m !== null && (m[1] ?? '').length >= open.length;
  }
  const m = /^(~{3,})[ \t]*$/.exec(line);
  return m !== null && (m[1] ?? '').length >= open.length;
}

/**
 * Returns the diagram source when `body` (the content between outer fence
 * markers) is itself a complete, self-contained mermaid fence. Returns null
 * for any other shape.
 *
 * Accepted shape (leading and trailing blank lines in `body` are ignored):
 *
 *   ```mermaid   (or ~~~mermaid, any fence length >= 3)
 *   <diagram source>
 *   ```           (closing line that satisfies CommonMark against the inner opener)
 *
 * Any non-blank lines after the inner close cause null to be returned, so a
 * body that contains more content than one mermaid fence is left alone.
 */
export function extractInnerMermaidFence(body: string): string | null {
  const lines = body.split('\n');

  // Skip leading blank lines to find the first real content.
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') start += 1;
  if (start >= lines.length) return null;

  const innerOpen = matchFenceOpen(lines[start] ?? '');
  if (!innerOpen) return null;
  if (innerOpen.lang.toLowerCase() !== 'mermaid') return null;

  // Collect inner body lines up to (but not including) the inner close.
  const innerBody: string[] = [];
  let i = start + 1;
  while (i < lines.length && !isFenceClose(lines[i] ?? '', innerOpen)) {
    innerBody.push(lines[i] ?? '');
    i += 1;
  }
  // `i` now points at the closing line, or is past the end (unclosed fence).
  if (i >= lines.length) return null;

  // After the inner close, only blank lines are permitted.
  for (let j = i + 1; j < lines.length; j++) {
    if ((lines[j] ?? '').trim() !== '') return null;
  }

  return innerBody.join('\n');
}

/** Outer lang tags that carry no type information and may wrap a mermaid fence. */
const COLLAPSIBLE_OUTER_LANGS = new Set(['', 'text', 'txt', 'plain', 'mermaid']);

/**
 * Rewrites every fenced block in `source` whose body is itself a complete
 * mermaid fence into a clean ` ```mermaid\n<diagram>\n``` ` block.
 *
 * This handles the Lexical markdown export pattern where a paste of a
 * ` ```mermaid ` fence ends up wrapped in a longer outer fence (e.g. 4
 * backticks with no lang tag). Only outer fences with a generic or `mermaid`
 * lang tag are candidates for collapse; language-specific outer fences (e.g.
 * ` ```typescript `) are left unchanged.
 *
 * Safe to run repeatedly: already-clean mermaid fences produce identical output.
 */
export function collapseNestedMermaidFences(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fenceOpen = matchFenceOpen(line);

    if (!fenceOpen) {
      out.push(line);
      i += 1;
      continue;
    }

    // Collect outer body lines until the outer close.
    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !isFenceClose(lines[j] ?? '', fenceOpen)) {
      bodyLines.push(lines[j] ?? '');
      j += 1;
    }
    const closeLine = j < lines.length ? (lines[j] ?? '') : null;

    const outerLang = fenceOpen.lang.toLowerCase();
    const body = bodyLines.join('\n');
    const inner = COLLAPSIBLE_OUTER_LANGS.has(outerLang) ? extractInnerMermaidFence(body) : null;

    if (inner !== null) {
      // Rewrite to a clean mermaid fence, discarding the outer shell.
      out.push('```mermaid');
      // `inner` may contain newlines; it lands as a single element and joins
      // correctly because out.join('\n') separates elements with a single '\n'.
      out.push(inner);
      out.push('```');
    } else {
      // Emit the block unchanged, preserving every original line.
      out.push(line);
      out.push(...bodyLines);
      if (closeLine !== null) out.push(closeLine);
    }

    i = closeLine !== null ? j + 1 : j;
  }

  return out.join('\n');
}
