import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract, globalStateSchema, projectStateSchema, updateStatusSchema, STATE_CHANGED } from "../shared/rpc.ts";
import { loadCatalog, loadRuntimeNote, findPluginRoot, registeredSkillNames, detectPrerequisites } from "./files.ts";
import { resolveSkills, applySkillChanges, defaultGlobal, defaultProject, type GlobalState, type ProjectState, type Scope } from "./resolve.ts";
import { fetchUpdates, initialUpdate, errorMessage, type Fetch, type UpdateStatus } from "./updates.ts";
import { registerCli } from "./cli.ts";

export interface BackendOptions {
  root?: string;
  catalogPath?: string;
  runtimeNotePath?: string;
  registeredNames?: ReadonlySet<string>;
  prerequisites?: Record<string, boolean>;
  fetch?: Fetch;
  /** null skips the startup check in tests. Production checks after one second. */
  startupDelayMs?: number | null;
}

export async function startBackend(bb: BbPluginApi, options: BackendOptions = {}) {
  const root = options.root ?? await findPluginRoot();
  const catalog = await loadCatalog(options.catalogPath ?? join(root, "generated", "catalog.json"));
  const version = z.object({ version: z.string() }).parse(JSON.parse(await readFile(join(root, "package.json"), "utf8"))).version;
  const runtimeNote = await loadRuntimeNote(options.runtimeNotePath ?? join(root, "server", "bb-runtime-note.md"));
  const registered = options.registeredNames ?? await registeredSkillNames(root, catalog);
  const catalogNames = new Set(catalog.skills.map(skill => skill.bbName));
  const allowedNames = new Set([...registered].filter(name => catalogNames.has(name)));
  // A registered router is unsafe if even one transitive dependency is missing
  // from the static registrations. Exclude it too, rather than stage a broken skill.
  const byId = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const safeIds = new Set(catalog.skills.filter(skill => {
    const pending = [skill.id];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const dependency = byId.get(id);
      if (!dependency || !allowedNames.has(dependency.bbName)) return false;
      pending.push(...dependency.requires);
    }
    return true;
  }).map(skill => skill.id));
  if (allowedNames.size !== catalog.skills.length) bb.log.warn("Some catalog names lack matching static pstack skill registrations; those skills are excluded from agent configuration");
  const prerequisites = options.prerequisites ?? await detectPrerequisites();
  let global: GlobalState = defaultGlobal();
  const projects = new Map<string, ProjectState>();
  let seenSkills: string[] = [];
  let startHereDismissed = false;
  let update = initialUpdate(catalog, version);
  const lifecycle = new AbortController();

  async function readStored<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    try {
      const value = await bb.storage.kv.get<unknown>(key);
      if (value === undefined || value === null) return fallback;
      const result = schema.safeParse(value);
      if (result.success) return result.data;
      bb.log.warn(`Ignoring malformed pstack state at ${key}`);
    } catch (error) { bb.log.error(`Reading ${key}: ${errorMessage(error)}`); }
    return fallback;
  }
  const projectKeys = await bb.storage.kv.list("project:");
  await Promise.all([
    readStored("global", globalStateSchema, global).then(value => { global = value; }),
    readStored("seenSkills", z.array(z.string()), seenSkills).then(value => { seenSkills = value; }),
    readStored("startHereDismissed", z.boolean(), false).then(value => { startHereDismissed = value; }),
    readStored("updateStatus", updateStatusSchema, update).then(value => {
      // A cached ahead count belongs to its old bundled commit. Remote identities
      // survive an upgrade, but that count must be recomputed for the new bundle.
      const sameBundle = value.bundledCommit === catalog.upstream.commit;
      update = {
        ...value, bundledCommit: catalog.upstream.commit, bundledVersion: catalog.upstream.version, installedPluginVersion: version,
        upstreamCommitsAhead: sameBundle ? value.upstreamCommitsAhead : value.latestUpstreamCommit === catalog.upstream.commit ? 0 : null,
        checkedAt: sameBundle ? value.checkedAt : null,
      };
    }),
    ...projectKeys.map(async key => projects.set(key.slice("project:".length), await readStored(key, projectStateSchema, defaultProject()))),
  ]);
  // First install: everything in this release counts as seen (no "New" badges).
  if ((await bb.storage.kv.get<unknown>("seenSkills")) == null) {
    seenSkills = catalog.skills.map(skill => skill.id);
    await bb.storage.kv.set("seenSkills", seenSkills);
  }
  const projectAt = (id: string): ProjectState => projects.get(id) ?? defaultProject();
  const projectFor = (scope: Scope): ProjectState | null => scope.kind === "global" ? null : projectAt(scope.projectId);
  const resolved = (scope: Scope) => resolveSkills(catalog, global, projectFor(scope), seenSkills);

  // Never call async storage during agent resolution. Keep independent last-good
  // selections per project so an exceptional callback cannot leak another scope.
  const lastGood = new Map<string, string[]>();
  function activeNames(projectId: string): string[] {
    try {
      const active = resolveSkills(catalog, global, projectAt(projectId), seenSkills);
      const activeIds = new Set(active.filter(skill => skill.active).map(skill => skill.id));
      const names = [...new Set(catalog.skills.filter(skill => activeIds.has(skill.id) && safeIds.has(skill.id)).map(skill => skill.bbName))]
        .filter(name => allowedNames.has(name));
      lastGood.set(projectId, names);
      return [...names];
    } catch (error) {
      bb.log.error(`Resolving pstack skills: ${errorMessage(error)}`);
      return [...(lastGood.get(projectId) ?? [])].filter(name => allowedNames.has(name));
    }
  }
  bb.agents.configure(ctx => {
    try { return { tools: [], skills: activeNames(ctx.project.id) }; }
    catch (error) { bb.log.error(`Configuring pstack skills: ${errorMessage(error)}`); return { tools: [], skills: [] }; }
  });
  bb.agents.contributeInstructions(({ projectId }) => {
    try { return runtimeNote && activeNames(projectId).length ? runtimeNote : null; }
    catch (error) { bb.log.error(`Contributing pstack instructions: ${errorMessage(error)}`); return null; }
  });

  // Serial read/modify/write, shared by RPC and CLI. A failed persistence leaves
  // both memory and later queued operations at the prior committed state.
  let writes: Promise<unknown> = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = writes.then(() => {
      if (lifecycle.signal.aborted) throw new Error("pstack backend is disposed");
      return operation();
    });
    writes = pending.catch(() => undefined);
    return pending;
  }
  function publish() {
    try { bb.realtime.publish(STATE_CHANGED, { changed: true }); }
    catch (error) { bb.log.error(`Publishing pstack state: ${errorMessage(error)}`); }
  }
  async function persistScope(scope: Scope, next: GlobalState | ProjectState) {
    if (scope.kind === "global") {
      await bb.storage.kv.set("global", next);
      global = next as GlobalState;
    } else {
      await bb.storage.kv.set(`project:${scope.projectId}`, next);
      projects.set(scope.projectId, next as ProjectState);
    }
    publish();
  }

  let pendingCheck: Promise<UpdateStatus> | null = null;
  function checkUpdates(): Promise<UpdateStatus> {
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      const next = await fetchUpdates(catalog, version, options.fetch, lifecycle.signal);
      return serialize(async () => {
        await bb.storage.kv.set("updateStatus", next);
        update = next;
        publish();
        return structuredClone(update);
      });
    })().finally(() => { pendingCheck = null; });
    return pendingCheck;
  }

  const handlers: PluginRpcHandlers<typeof rpcContract> = {
    pstack_state: async ({ scope }) => {
      await writes;
      // SDK list returns project DTOs directly, not a { projects } wrapper.
      const available = await bb.sdk.projects.list({ includePersonal: true });
      return {
        catalog: structuredClone(catalog), global: structuredClone(global), project: structuredClone(projectFor(scope)),
        resolved: resolved(scope), projects: available.map(({ id, name }) => ({ id, name, mode: projectAt(id).mode, enabled: projectAt(id).mode === "custom" ? projectAt(id).enabled : global.enabled })),
        prerequisites: { ...prerequisites }, update: structuredClone(update), startHereDismissed,
      };
    },
    pstack_set_skills: ({ scope, changes, cascade }) => serialize(async () => {
      const project = scope.kind === "project" ? { ...projectAt(scope.projectId), mode: "custom" as const } : null;
      const skills = applySkillChanges(catalog, global, project, seenSkills, changes, cascade);
      await persistScope(scope, project ? { ...project, skills } : { ...global, skills });
      return { resolved: resolved(scope) };
    }),
    pstack_set_master: ({ scope, enabled }) => serialize(async () => {
      await persistScope(scope, scope.kind === "global" ? { ...global, enabled } : { ...projectAt(scope.projectId), mode: "custom", enabled });
      return { ok: true as const };
    }),
    pstack_set_project_mode: ({ projectId, mode }) => serialize(async () => {
      await persistScope({ kind: "project", projectId }, { ...projectAt(projectId), mode });
      return { ok: true as const };
    }),
    pstack_set_new_skills_default: ({ value }) => serialize(async () => {
      await persistScope({ kind: "global" }, { ...global, newSkillsDefault: value });
      return { ok: true as const };
    }),
    pstack_dismiss_start_here: ({ dismissed }) => serialize(async () => {
      await bb.storage.kv.set("startHereDismissed", dismissed);
      startHereDismissed = dismissed;
      publish();
      return { ok: true as const };
    }),
    pstack_mark_seen: () => serialize(async () => {
      // Seen skills default to "on", so pin an "off" default explicitly first:
      // acknowledging a new skill must never switch it on.
      if (global.newSkillsDefault === "off") {
        const seen = new Set(seenSkills);
        const pinned = { ...global.skills };
        for (const skill of catalog.skills) if (!seen.has(skill.id) && !(skill.id in pinned)) pinned[skill.id] = "off";
        await persistScope({ kind: "global" }, { ...global, skills: pinned });
      }
      const next = catalog.skills.map(skill => skill.id);
      await bb.storage.kv.set("seenSkills", next);
      seenSkills = next;
      publish();
      return { ok: true as const };
    }),
    pstack_check_updates: () => checkUpdates(),
  };
  bb.rpc.register(rpcContract, handlers);
  registerCli(bb, handlers);
  bb.background.schedule("upstream-check", "0 */6 * * *", async () => { await checkUpdates(); });
  const delay = options.startupDelayMs === undefined ? 1000 : options.startupDelayMs;
  const timer = delay === null ? null : setTimeout(() => {
    void checkUpdates().catch(error => bb.log.error(`Startup update check: ${errorMessage(error)}`));
  }, delay);
  bb.onDispose(() => {
    if (timer !== null) clearTimeout(timer);
    lifecycle.abort(new Error("pstack backend disposed"));
    lastGood.clear();
  });
  bb.log.info(`loaded ${catalog.skills.length} pstack skills`);
}
