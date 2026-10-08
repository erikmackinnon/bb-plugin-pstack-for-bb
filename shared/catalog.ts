// Shape of generated/catalog.json, written by scripts/build.ts and read by
// server.ts (toggles, dependency closure) and app.tsx (the page). This file is
// the contract between workers; change it only with every consumer updated.
import { z } from "zod";

export const SKILL_GROUPS = [
  "entry-points",
  "workflow",
  "investigation",
  "verification",
  "style",
  "principles",
  "other",
] as const;
export type SkillGroup = (typeof SKILL_GROUPS)[number];

export const catalogSkillSchema = z.object({
  /** Upstream directory name, e.g. "poteto-mode". Stable key for toggles. */
  id: z.string(),
  /** Name bb resolves for this skill (what configure() must return). */
  bbName: z.string(),
  /** Human label, from upstream frontmatter `name` (e.g. "Poteto Mode"). */
  displayName: z.string(),
  description: z.string(),
  group: z.enum(SKILL_GROUPS),
  /**
   * Skills this one references and needs at runtime (ids). Computed from the
   * upstream text at build time. The server keeps every dependency of an
   * enabled skill active, so toggling can never break a skill.
   */
  requires: z.array(z.string()),
  /** Reverse edges, for the UI ("needed by poteto-mode"). */
  requiredBy: z.array(z.string()),
  /** Ships executable helpers (scripts/**). */
  hasScripts: z.boolean(),
  /** Runtime prerequisites the UI should surface, e.g. ["bun", "gh"]. */
  prerequisites: z.array(z.string()),
  /** Upstream frontmatter has disable-model-invocation: true (slash-command only). */
  userInvocableOnly: z.boolean(),
  /** sha256 over the upstream skill folder (sorted paths + bytes). */
  upstreamHash: z.string(),
  /** Ids of compat rules that changed any file in this skill. */
  compatRules: z.array(z.string()),
});
export type CatalogSkill = z.infer<typeof catalogSkillSchema>;

export const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  upstream: z.object({
    repo: z.literal("cursor/plugins"),
    path: z.literal("pstack"),
    commit: z.string(),
    /** From upstream .cursor-plugin/plugin.json `version`. */
    version: z.string(),
    /** ISO date of the upstream commit. */
    committedAt: z.string(),
    license: z.string(),
    author: z.string(),
  }),
  skills: z.array(catalogSkillSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
