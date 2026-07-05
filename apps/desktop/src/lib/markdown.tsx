import type { ReactNode } from 'react';
import type { LinkResolver, OpenLink } from './links';

/**
 * A small, dependency-free Markdown renderer covering the constructs the
 * spec guarantees in entity bodies: headings, paragraphs, bold and italic,
 * links, wiki-links, lists, task lists, tables, fenced code, blockquotes.
 * The block editor handles editing; this keeps read-only views honest without
 * pulling in an HTML pipeline.
 */

/** Resolver + open handler for `[[id]]` wiki-links; absent = render them inert. */
interface WikiCtx {
  resolve: LinkResolver;
  onOpen: OpenLink;
}

function inline(text: string, key = 0, ctx?: WikiCtx): ReactNode {
  // code spans first so other markup inside them is left alone
  const parts: ReactNode[] = [];
  let rest = text;
  const patterns: Array<[RegExp, (m: RegExpMatchArray, k: number) => ReactNode]> = [
    [/`([^`]+)`/, (m, k) => <code key={k}>{m[1]}</code>],
    [
      // wiki-link `[[id]]`: matched before the standard link so `[[` never
      // reads as an empty `[text]`.
      /\[\[([^\]\n]+)\]\]/,
      (m, k) => {
        const id = (m[1] ?? '').trim();
        const target = ctx?.resolve(id) ?? null;
        if (!target) {
          return (
            <span key={k} className="wikilink broken" title={`Unresolved link: ${id}`}>
              [[{id}]]
            </span>
          );
        }
        return (
          <button
            key={k}
            type="button"
            className={`wikilink ${target.kind}`}
            title={`${target.kind} · ${target.id}`}
            onClick={(e) => {
              e.preventDefault();
              ctx?.onOpen(target);
            }}
          >
            {target.label}
          </button>
        );
      },
    ],
    [/\*\*([^*]+)\*\*/, (m, k) => <strong key={k}>{inline(m[1] ?? '', k * 31 + 7, ctx)}</strong>],
    [/(?<![*\w])\*([^*]+)\*(?![*\w])/, (m, k) => <em key={k}>{inline(m[1] ?? '', k * 31 + 11, ctx)}</em>],
    [
      /\[([^\]]+)\]\(([^)]+)\)/,
      (m, k) => (
        <a key={k} href={m[2]} onClick={(e) => e.preventDefault()} title={m[2]}>
          {m[1]}
        </a>
      ),
    ],
  ];
  while (rest.length > 0) {
    let earliest: { index: number; match: RegExpMatchArray; render: (m: RegExpMatchArray, k: number) => ReactNode } | null = null;
    for (const [re, render] of patterns) {
      const match = rest.match(re);
      if (match && match.index !== undefined) {
        if (!earliest || match.index < earliest.index) {
          earliest = { index: match.index, match, render };
        }
      }
    }
    if (!earliest) {
      parts.push(rest);
      break;
    }
    if (earliest.index > 0) parts.push(rest.slice(0, earliest.index));
    parts.push(earliest.render(earliest.match, key + parts.length + 1));
    rest = rest.slice(earliest.index + earliest.match[0].length);
  }
  return parts;
}

export function Markdown({
  source,
  onToggleTask,
  resolveLink,
  onOpenLink,
}: {
  source: string;
  /** When provided, task checkboxes are editable; index counts tasks in document order. */
  onToggleTask?: (taskIndex: number, next: boolean) => void;
  /** Resolves `[[id]]` wiki-links to their current target for display. */
  resolveLink?: LinkResolver;
  /** Opens a clicked wiki-link. */
  onOpenLink?: OpenLink;
}) {
  const ctx: WikiCtx | undefined =
    resolveLink && onOpenLink ? { resolve: resolveLink, onOpen: onOpenLink } : undefined;
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  let taskCount = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const Tag = `h${Math.min(level, 6)}` as 'h1';
      blocks.push(<Tag key={key++}>{inline(headingMatch[2] ?? '', 0, ctx)}</Tag>);
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={key++} data-lang={lang}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quote.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++}>
          <Markdown source={quote.join('\n')} resolveLink={resolveLink} onOpenLink={onOpenLink} />
        </blockquote>,
      );
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] ?? '')) {
        rows.push(lines[i] ?? '');
        i += 1;
      }
      const parseRow = (row: string) =>
        row
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
      const header = parseRow(rows[0] ?? '');
      const bodyRows = rows.slice(rows[1]?.match(/^\|[\s:-]+\|$/) ? 2 : 1).map(parseRow);
      blocks.push(
        <table key={key++}>
          <thead>
            <tr>
              {header.map((h, hi) => (
                <th key={hi}>{inline(h, 0, ctx)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td key={ci}>{inline(c, 0, ctx)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2] ?? '');
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i] ?? '');
        if (!m) break;
        const text = m[3] ?? '';
        const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
        if (task) {
          const checked = task[1] !== ' ';
          const idx = taskCount;
          taskCount += 1;
          items.push(
            <li key={items.length} className="task-item">
              <input
                type="checkbox"
                checked={checked}
                {...(onToggleTask
                  ? { onChange: () => onToggleTask(idx, !checked) }
                  : { readOnly: true })}
              />
              {inline(task[2] ?? '', 0, ctx)}
            </li>,
          );
        } else {
          items.push(<li key={items.length}>{inline(text, 0, ctx)}</li>);
        }
        i += 1;
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#|```|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i] ?? '')) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push(<p key={key++}>{inline(para.join(' '), 0, ctx)}</p>);
  }

  return <div className="prose">{blocks}</div>;
}
