// Display helpers for turning data-defined identifiers into readable labels.
// Stored values are never changed; only what the user sees.

const ACRONYMS: Record<string, string> = { id: 'ID', url: 'URL', api: 'API', ui: 'UI' };

/** "in_progress" / "in-progress" / "in progress" -> "In Progress"; "id" -> "ID". */
export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "In Progress" -> "in_progress"; the machine name derived from a human label. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Display-name resolvers: an explicit human label when present, otherwise the
// Title-Cased machine name. Statuses, types and fields all follow this.
export function statusLabel(status: { name: string; label?: string }): string {
  return status.label ?? titleCase(status.name);
}

export function fieldLabel(field: { name: string; label?: string }): string {
  return field.label ?? titleCase(field.name);
}

export function typeLabel(type: { name: string; label?: string }): string {
  return type.label ?? titleCase(type.name);
}

export function typePlural(type: { name: string; plural?: string }): string {
  return type.plural ?? `${titleCase(type.name)}s`;
}
