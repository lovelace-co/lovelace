import { extractSection } from './frontmatter.js';
import { validateProject } from './validate.js';
import type { Project } from './types.js';

export interface DigestOptions {
  now?: () => Date;
  /** Soft character budget; roughly four characters per token. */
  maxChars?: number;
}

/**
 * A compact orientation summary for agent session starts: in-progress work,
 * recent sessions with their open questions, and validation warnings.
 * Plain text, designed to be injected into an agent's context.
 */
export function buildDigest(project: Project, options: DigestOptions = {}): string {
  const maxChars = options.maxChars ?? 5500;
  const lines: string[] = [];
  lines.push(`Lovelace digest for ${project.manifest.name}`);
  lines.push('');

  const wipStatuses = new Set(
    project.workflow.statuses.filter((s) => s.active).map((s) => s.name),
  );
  const wip = project.tickets
    .filter((t) => wipStatuses.has(t.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  lines.push('In progress:');
  if (wip.length === 0) {
    lines.push('  (nothing in progress)');
  }
  for (const t of wip) {
    const title = typeof t.fields.title === 'string' ? t.fields.title : '';
    const assignee = typeof t.fields.assignee === 'string' ? ` @${t.fields.assignee}` : '';
    lines.push(`  ${t.id} [${t.status}]${assignee} ${title}`);
    // The legal next statuses, so the agent resolves to a real status rather
    // than inventing one. Only these transitions will be accepted.
    const moves = project.workflow.transitions.find((tr) => tr.from === t.status)?.to ?? [];
    if (moves.length > 0) {
      lines.push(`    moves to: ${moves.join(', ')}`);
    }
  }
  lines.push('');

  const recent = [...project.sessions].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 3);
  lines.push('Recent sessions:');
  if (recent.length === 0) {
    lines.push('  (none yet)');
  }
  for (const s of recent) {
    lines.push(`  ${s.id} on ${s.ticket}: ${s.outcome}`);
    const questions = extractSection(s.body, 'Open questions');
    if (questions && questions.replace(/[-\s]/g, '') !== 'None.'.replace(/[-\s]/g, '')) {
      for (const q of questions.split('\n').filter((l) => l.trim().startsWith('- '))) {
        const text = q.trim().slice(2).trim();
        if (text && text.toLowerCase() !== 'none.') {
          lines.push(`    open: ${text}`);
        }
      }
    }
  }
  lines.push('');

  const issues = validateProject(project, options.now ? { now: options.now } : {});
  const warnings = issues.filter((i) => i.severity === 'warning');
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    lines.push(`Validation errors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) {
      lines.push(`  ${e.file}${e.line !== undefined ? `:${e.line}` : ''} ${e.message}`);
    }
    lines.push('');
  }
  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 10)) {
      lines.push(`  ${w.file}${w.line !== undefined ? `:${w.line}` : ''} ${w.message}`);
    }
    lines.push('');
  }

  let out = lines.join('\n').trimEnd() + '\n';
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars - 12).trimEnd()}\n(truncated)\n`;
  }
  return out;
}
