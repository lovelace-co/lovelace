import type { Project } from './types.js';

export interface SearchHit {
  kind: 'ticket' | 'document' | 'session' | 'comment';
  id: string;
  path: string;
  /** Why it matched: the line containing the first hit, trimmed. */
  snippet: string;
  score: number;
}

function snippetFor(text: string, needle: string): string | undefined {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx === -1) return undefined;
  const lineStart = text.lastIndexOf('\n', idx) + 1;
  let lineEnd = text.indexOf('\n', idx);
  if (lineEnd === -1) lineEnd = text.length;
  return text.slice(lineStart, lineEnd).trim().slice(0, 200);
}

/**
 * Plain substring search across titles, summaries and bodies. Title and
 * summary hits rank above body hits; no embeddings, no stemming.
 */
export function search(project: Project, query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: SearchHit[] = [];

  for (const t of project.tickets) {
    const title = typeof t.fields.title === 'string' ? t.fields.title : '';
    let score = 0;
    if (title.toLowerCase().includes(needle)) score += 4;
    if (t.id.toLowerCase() === needle) score += 5;
    if (t.body.toLowerCase().includes(needle)) score += 1;
    if (score > 0) {
      hits.push({
        kind: 'ticket',
        id: t.id,
        path: t.path,
        snippet: snippetFor(`${title}\n${t.body}`, needle) ?? title,
        score,
      });
    }
  }
  for (const b of project.documents) {
    let score = 0;
    if (b.summary.toLowerCase().includes(needle)) score += 3;
    if (b.body.toLowerCase().includes(needle)) score += 1;
    if (score > 0) {
      hits.push({
        kind: 'document',
        id: b.id,
        path: b.path,
        snippet: snippetFor(`${b.summary}\n${b.body}`, needle) ?? b.summary,
        score,
      });
    }
  }
  for (const s of project.sessions) {
    if (s.body.toLowerCase().includes(needle)) {
      hits.push({
        kind: 'session',
        id: s.id,
        path: s.path,
        snippet: snippetFor(s.body, needle) ?? '',
        score: 1,
      });
    }
  }
  for (const c of project.comments) {
    if (c.body.toLowerCase().includes(needle)) {
      hits.push({
        kind: 'comment',
        id: c.ticket,
        path: c.path,
        snippet: snippetFor(c.body, needle) ?? '',
        score: 1,
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}
