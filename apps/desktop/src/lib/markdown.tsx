import type { ReactNode } from 'react';

/**
 * A small, dependency-free Markdown renderer covering the constructs the
 * spec guarantees in entity bodies: headings, paragraphs, bold and italic,
 * links, lists, task lists, tables, fenced code, blockquotes. Phase 5
 * replaces read-only rendering with the WYSIWYG editor; this keeps Phase 3
 * honest without pulling in an HTML pipeline.
 */

function inline(text: string, key = 0): ReactNode {
  // code spans first so other markup inside them is left alone
  const parts: ReactNode[] = [];
  let rest = text;
  let i = 0;
  const patterns: Array<[RegExp, (m: RegExpMatchArray, k: number) => ReactNode]> = [
    [/`([^`]+)`/, (m, k) => <code key={k}>{m[1]}</code>],
    [/\*\*([^*]+)\*\*/, (m, k) => <strong key={k}>{inline(m[1] ?? '', k * 31 + 7)}</strong>],
    [/(?<![*\w])\*([^*]+)\*(?![*\w])/, (m, k) => <em key={k}>{inline(m[1] ?? '', k * 31 + 11)}</em>],
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
}: {
  source: string;
  /** When provided, task checkboxes are editable; index counts tasks in document order. */
  onToggleTask?: (taskIndex: number, next: boolean) => void;
}) {
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
      blocks.push(<Tag key={key++}>{inline(headingMatch[2] ?? '')}</Tag>);
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
          <Markdown source={quote.join('\n')} />
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
                <th key={hi}>{inline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td key={ci}>{inline(c)}</td>
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
              {inline(task[2] ?? '')}
            </li>,
          );
        } else {
          items.push(<li key={items.length}>{inline(text)}</li>);
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
    blocks.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }

  return <div className="prose">{blocks}</div>;
}
