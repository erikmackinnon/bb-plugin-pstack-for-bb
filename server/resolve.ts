import type { z } from "zod";
import type { Catalog } from "../shared/catalog.ts";
import type {
  globalStateSchema,
  projectStateSchema,
  resolvedSkillSchema,
  scopeSchema,
} from "../shared/rpc.ts";

export type GlobalState = z.infer<typeof globalStateSchema>;
export type ProjectState = z.infer<typeof projectStateSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type ResolvedSkill = z.infer<typeof resolvedSkillSchema>;
type Toggle = "on" | "off";
type SkillChange = { id: string; value: Toggle | null };

export function defaultGlobal(): GlobalState {
  return { enabled: true, skills: {}, newSkillsDefault: "on" };
}

export function defaultProject(): ProjectState {
  return { mode: "inherit", enabled: true, skills: {} };
}

function explicit(skills: Record<string, Toggle>, id: string): Toggle | undefined {
  return Object.hasOwn(skills, id) ? skills[id] : undefined;
}

function choices(
  catalog: Catalog,
  global: GlobalState,
  project: ProjectState | null,
  seenSkills: string[],
): Map<string, { value: Toggle; explicit: boolean }> {
  const seen = new Set(seenSkills);
  return new Map(catalog.skills.map(({ id }) => {
    const local = project?.mode === "custom" ? explicit(project.skills, id) : undefined;
    const inherited = explicit(global.skills, id);
    return [id, {
      value: local ?? inherited ?? (seen.has(id) ? "on" : global.newSkillsDefault),
      explicit: project === null ? inherited !== undefined : local !== undefined,
    }];
  }));
}

/** Compute each transitive closure with a visited set, including cycles safely. */
function dependencyClosures(catalog: Catalog): Map<string, Set<string>> {
  const skills = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const closures = new Map<string, Set<string>>();
  for (const skill of catalog.skills) {
    const visited = new Set<string>();
    const pending = [skill.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id) || !skills.has(id)) continue;
      visited.add(id);
      pending.push(...skills.get(id)!.requires);
    }
    closures.set(skill.id, visited);
  }
  return closures;
}

export function resolveSkills(
  catalog: Catalog,
  global: GlobalState,
  project: ProjectState | null,
  seenSkills: string[],
): ResolvedSkill[] {
  const chosen = choices(catalog, global, project, seenSkills);
  const closures = dependencyClosures(catalog);
  const seen = new Set(seenSkills);
  // Global is the default; a customized project's own switch always wins, so
  // pstack can be off by default and on only in chosen projects.
  const enabled = project?.mode === "custom" ? project.enabled : global.enabled;
  const active = new Set<string>();
  if (enabled) {
    for (const [id, choice] of chosen) {
      if (choice.value === "on") {
        for (const dependency of closures.get(id)!) active.add(dependency);
      }
    }
  }
  return catalog.skills.map(({ id }) => {
    const choice = chosen.get(id)!;
    let reason: ResolvedSkill["reason"];
    let neededBy: string[] = [];
    if (!enabled) {
      reason = "off-master";
    } else if (choice.value === "off" && active.has(id)) {
      reason = "on-required";
      neededBy = catalog.skills
        .filter((skill) => skill.id !== id && active.has(skill.id) && closures.get(skill.id)!.has(id))
        .map((skill) => skill.id);
    } else {
      reason = choice.value === "on"
        ? choice.explicit ? "on-explicit" : "on-inherited"
        : choice.explicit ? "off-explicit" : "off-inherited";
    }
    return { id, active: active.has(id), reason, neededBy, isNew: !seen.has(id) };
  });
}

/** Return a fresh explicit map for the target scope; never mutate stored state. */
export function applySkillChanges(
  catalog: Catalog,
  global: GlobalState,
  project: ProjectState | null,
  seenSkills: string[],
  changes: SkillChange[],
  cascade: boolean,
): Record<string, Toggle> {
  const ids = new Set(catalog.skills.map((skill) => skill.id));
  for (const change of changes) {
    if (!ids.has(change.id)) throw new Error(`Unknown skill: ${change.id}`);
  }
  const current = project === null ? global.skills : project.skills;
  const next: Record<string, Toggle> = Object.fromEntries(
    Object.entries(current).filter(([id]) => ids.has(id)),
  );
  for (const { id, value } of changes) {
    if (value === null) delete next[id];
    else Object.defineProperty(next, id, { value, writable: true, enumerable: true, configurable: true });
  }
  if (cascade) {
    const offIds = new Set(changes.filter(({ value }) => value === "off").map(({ id }) => id));
    if (offIds.size > 0) {
      const chosen = choices(catalog, global, project, seenSkills);
      const closures = dependencyClosures(catalog);
      for (const [id, choice] of chosen) {
        if (choice.value === "on" && [...offIds].some((offId) => closures.get(id)!.has(offId))) {
          offIds.add(id);
        }
      }
      // Apply last so a conflicting on/null change cannot undo a requested cascade.
      for (const id of offIds) {
        Object.defineProperty(next, id, { value: "off", writable: true, enumerable: true, configurable: true });
      }
    }
  }
  return next;
}
