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
 * work ready to pick up, recent sessions with their open questions, and
 * validation warnings. Plain text, designed to be injected into an agent's
 * context.
 */
export function buildDigest(project: Project, options: DigestOptions = {}): string {
  const maxChars = options.maxChars ?? 5500;
  const lines: string[] = [];
  lines.push(`Lovelace digest for ${project.manifest.name}`);
  lines.push('');

  const ticketLine = (t: Project['tickets'][number]) => {
    const title = typeof t.fields.title === 'string' ? t.fields.title : '';
    const assignee = typeof t.fields.assignee === 'string' ? ` @${t.fields.assignee}` : '';
    return `  ${t.id} [${t.status}]${assignee} ${title}`;
  };

  const inProgressStatuses = new Set(
    project.schema.statuses.filter((s) => s.agent === 'in_progress').map((s) => s.name),
  );
  const inProgress = project.tickets
    .filter((t) => inProgressStatuses.has(t.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  lines.push('In progress:');
  if (inProgress.length === 0) {
    lines.push('  (nothing in progress)');
  }
  for (const t of inProgress) {
    lines.push(ticketLine(t));
  }
  lines.push('');

  const readyStatuses = new Set(
    project.schema.statuses.filter((s) => s.agent === 'ready').map((s) => s.name),
  );
  const ready = project.tickets
    .filter((t) => readyStatuses.has(t.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  lines.push('Ready to pick up:');
  if (ready.length === 0) {
    lines.push('  (nothing ready)');
  }
  for (const t of ready) {
    lines.push(ticketLine(t));
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
