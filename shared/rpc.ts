// RPC contract between server.ts and app.tsx. Owned jointly by the server and
// UI workers; change only with both sides updated.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { catalogSchema } from "./catalog.ts";

/** A user's explicit choice for one skill. Absent = use the default. */
export const toggleSchema = z.enum(["on", "off"]);

export const globalStateSchema = z.object({
  /** Master switch: false disables every pstack skill everywhere. */
  enabled: z.boolean(),
  /** Explicit per-skill choices keyed by catalog id. */
  skills: z.record(z.string(), toggleSchema),
  /** Whether skills that appear in a new upstream release start on. */
  newSkillsDefault: toggleSchema,
});

export const projectStateSchema = z.object({
  /** "inherit" = use global exactly; "custom" = apply the overrides below. */
  mode: z.enum(["inherit", "custom"]),
  /** Master switch for this project (custom mode only). */
  enabled: z.boolean(),
  /** Per-skill overrides on top of global (custom mode only). */
  skills: z.record(z.string(), toggleSchema),
});

/** Why a skill is or isn't active in the resolved view. */
export const resolvedReasonSchema = z.enum([
  "on-explicit", //       user turned it on at this scope
  "on-inherited", //      on via global (project view) or default
  "on-required", //       user turned it off, but an active skill needs it
  "off-explicit",
  "off-inherited",
  "off-master", //        master switch off at this scope
]);

export const resolvedSkillSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  reason: resolvedReasonSchema,
  /** When reason is on-required: the active skills that need it. */
  neededBy: z.array(z.string()),
  /** Present in this release but not the previous one the user saw. */
  isNew: z.boolean(),
});

export const scopeSchema = z.union([
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("project"), projectId: z.string() }),
]);

export const updateStatusSchema = z.object({
  /** Upstream commit bundled in this installed plugin version. */
  bundledCommit: z.string(),
  bundledVersion: z.string(),
  /** Latest pstack commit on cursor/plugins main, from the daily check. */
  latestUpstreamCommit: z.string().nullable(),
  /** pstack commits upstream that this install doesn't have yet. */
  upstreamCommitsAhead: z.number().nullable(),
  /** Latest released version of this plugin on GitHub. */
  latestPluginVersion: z.string().nullable(),
  installedPluginVersion: z.string(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  pstack_state: {
    input: z.object({ scope: scopeSchema }),
    output: z.object({
      catalog: catalogSchema,
      global: globalStateSchema,
      project: projectStateSchema.nullable(),
      resolved: z.array(resolvedSkillSchema),
      projects: z.array(z.object({ id: z.string(), name: z.string(), mode: z.enum(["inherit", "custom"]), /** Effective on/off: own switch when custom, else the global default. */ enabled: z.boolean() })),
      prerequisites: z.record(z.string(), z.boolean()),
      update: updateStatusSchema,
      /** The user closed the "Start here" card; it stays closed. */
      startHereDismissed: z.boolean(),
    }),
  },
  /**
   * Set skills at a scope. `value: null` clears the explicit choice.
   * `cascade: true` when turning a skill off also turns off the active skills
   * that need it (the UI asks first); otherwise the skill stays on-required.
   */
  pstack_set_skills: {
    input: z.object({
      scope: scopeSchema,
      changes: z.array(z.object({ id: z.string(), value: toggleSchema.nullable() })),
      cascade: z.boolean().default(false),
    }),
    output: z.object({ resolved: z.array(resolvedSkillSchema) }),
  },
  pstack_set_master: {
    input: z.object({ scope: scopeSchema, enabled: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  pstack_set_project_mode: {
    input: z.object({ projectId: z.string(), mode: z.enum(["inherit", "custom"]) }),
    output: z.object({ ok: z.literal(true) }),
  },
  pstack_set_new_skills_default: {
    input: z.object({ value: toggleSchema }),
    output: z.object({ ok: z.literal(true) }),
  },
  pstack_dismiss_start_here: {
    input: z.object({ dismissed: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  pstack_mark_seen: {
    input: z.null(),
    output: z.object({ ok: z.literal(true) }),
  },
  pstack_check_updates: {
    input: z.null(),
    output: updateStatusSchema,
  },
});

export { STATE_CHANGED } from "./events.ts";
