export * from './types.js';
export { SPEC_VERSION, SUPPORTED_SPEC_MAJOR, classifySpecVersion } from './version.js';
export type { SpecFit } from './version.js';
export { parseFrontmatter, extractSection, FrontmatterError } from './frontmatter.js';
export {
  ConfigError,
  loadManifest,
  loadSchema,
  loadActors,
  validateSchema,
  defaultStatus,
} from './config.js';
export {
  fieldsForType,
  enumValues,
  validateTicketFields,
  applyDefaults,
  collectReferences,
} from './fields.js';
export { loadProject, ProjectError } from './project.js';
export { validateProject, hasErrors, formatIssues } from './validate.js';
export { buildIndex, stringifyIndex, buildBoard, writeIndex, fieldCatalogue } from './index-gen.js';
export { buildLinks } from './links.js';
export type { LinkEdge } from './links.js';
export { buildDigest } from './digest.js';
export { nextId, scanHighestId } from './ids.js';
export {
  createTicket,
  updateTicket,
  deleteTicket,
  writeSchema,
  writeManifest,
  writeActors,
  logSession,
  addComment,
  setActiveTicket,
  getActiveTicket,
  writeSessionActiveTicket,
  readSessionActiveTicket,
  writePresence,
  clearPresence,
  readPresences,
  beatPresence,
  DEFAULT_PRESENCE_TIMEOUT_MINUTES,
  MutationError,
} from './mutate.js';
export type {
  UpdateResult,
  UpdateTicketInput,
  CreateTicketInput,
  LogSessionInput,
  DeleteResult,
  MutationContext,
  SchemaEdit,
  SchemaRenames,
} from './mutate.js';
export { readBoardOrder, setColumnOrder, pruneFromBoardOrder } from './order.js';
export { readGraphLayout, writeGraphLayout } from './graph-layout.js';
export type { GraphLayout, NodePosition } from './graph-layout.js';
export { search } from './search.js';
export { initProject } from './init.js';
export { defaultSchema, serializeSchema } from './schema-config.js';
export { watchProject } from './watch.js';
export { migrationPath, planProjectMigration, migrateProject } from './migrations/registry.js';
export type { MigrationPlan, MigrationStep } from './migrations/types.js';
