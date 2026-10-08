import type { z } from "zod";
import type { rpcContract, scopeSchema } from "../../shared/rpc";
import type { CatalogSkill, SkillGroup } from "../../shared/catalog";

export type PstackState = z.infer<typeof rpcContract.pstack_state.output>;
export type Scope = z.infer<typeof scopeSchema>;
export type ResolvedSkill = PstackState["resolved"][number];
export const GROUP_LABELS: Record<SkillGroup, string> = {
  "entry-points": "Entry points",
  workflow: "Workflow & orchestration",
  investigation: "Investigation & review",
  verification: "Verification",
  style: "Code & prose style",
  principles: "Principles",
  other: "Other",
};

/** Traverse catalog edges with cycle protection; the server owns resolution. */
export function dependencies(skills: CatalogSkill[], ids: string[]): string[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const visited = new Set(ids);
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const dependency of byId.get(id)?.requires ?? []) {
      if (visited.has(dependency) || !byId.has(dependency)) continue;
      visited.add(dependency);
      result.add(dependency);
      visit(dependency);
    }
  };
  ids.forEach(visit);
  return [...result];
}

/** All active dependents, including indirect users of a dependency. */
export function activeDependents(state: PstackState, ids: string[]): string[] {
  const removed = new Set(ids);
  return state.resolved
    .filter(
      (skill) =>
        skill.active &&
        !removed.has(skill.id) &&
        dependencies(state.catalog.skills, [skill.id]).some((id) =>
          removed.has(id),
        ),
    )
    .map((skill) => skill.id);
}

export function differsFromGlobal(
  state: PstackState,
  skill: CatalogSkill,
): boolean {
  const override =
    state.project?.mode === "custom"
      ? state.project.skills[skill.id]
      : undefined;
  if (override === undefined) return false;
  const resolved = state.resolved.find((item) => item.id === skill.id);
  const globalChoice =
    state.global.skills[skill.id] ??
    (resolved?.isNew ? state.global.newSkillsDefault : "on");
  return override !== globalChoice;
}

export function newerRelease(
  latest: string | null,
  installed: string,
): boolean {
  if (!latest) return false;
  const parse = (version: string) =>
    /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const next = parse(latest);
  const current = parse(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index]! > current[index]!;
  }
  return false;
}

export type TurnOffPlan = {
  ids: string[];
  kept: { id: string; users: string[] }[];
  dependents: string[];
};

/** Preview the non-cascade result from the chosen roots, not orphaned dependencies. */
export function planTurnOff(state: PstackState, ids: string[]): TurnOffPlan {
  const active = new Set(
    state.resolved.filter((skill) => skill.active).map((skill) => skill.id),
  );
  const requested = [...new Set(ids)].filter((id) => active.has(id));
  const removed = new Set(requested);
  const remainingRoots = state.resolved
    .filter(
      (skill) =>
        skill.active &&
        skill.reason !== "on-required" &&
        !removed.has(skill.id),
    )
    .map((skill) => skill.id);
  const remaining = new Set([
    ...remainingRoots,
    ...dependencies(state.catalog.skills, remainingRoots),
  ]);
  const kept = requested
    .filter((id) => remaining.has(id))
    .map((id) => ({
      id,
      users: state.catalog.skills
        .filter(
          (skill) =>
            skill.id !== id &&
            remaining.has(skill.id) &&
            dependencies(state.catalog.skills, [skill.id]).includes(id),
        )
        .map((skill) => skill.id),
    }));
  return {
    ids: requested,
    kept,
    dependents: activeDependents(state, requested),
  };
}

export function turnOffCopy(plan: TurnOffPlan) {
  const kept = plan.kept.length;
  const total = plan.ids.length;
  return {
    title: "Some of these skills are used by others",
    body: `${kept} of the ${total} ${total === 1 ? "skill you're" : "skills you're"} turning off ${kept === 1 ? "is" : "are"} used by skills that are still on. Turning ${kept === 1 ? "it" : "them"} off would break those skills.`,
    keep: `Turn off ${total - kept}, keep ${kept} on`,
    cascade: `Turn off all ${total} + ${plan.dependents.length} that use ${total === 1 ? "it" : "them"}`,
  };
}

export function secondaryName(skill: CatalogSkill): string | null {
  const normalized = (value: string) =>
    value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return normalized(skill.displayName) === normalized(skill.id)
    ? null
    : skill.displayName;
}

export function keptOnText(users: string[]): string {
  const first = users.includes("poteto-mode") ? "poteto-mode" : users[0];
  if (!first) return "Kept on — used by active skills";
  return `Kept on — used by ${first}${users.length > 1 ? ` and ${users.length - 1} more` : ""}`;
}

export type ProjectChoice = "inherit" | "on" | "off";
export function projectChoice(project: PstackState["project"]): ProjectChoice {
  return project?.mode === "custom"
    ? project.enabled
      ? "on"
      : "off"
    : "inherit";
}

export function projectSuffix(
  project: PstackState["projects"][number],
): string {
  // Always show the effective state; mark projects that just follow the default.
  const state = project.enabled ? "on" : "off";
  return project.mode === "inherit" ? `${state} (default)` : state;
}

export function activitySummary(
  state: Pick<PstackState, "global" | "projects">,
): string {
  const enabled = state.global.enabled;
  const base = enabled ? "On by default" : "Off by default";
  const exceptions = state.projects.filter(
    (project) => project.mode === "custom" && project.enabled !== enabled,
  );
  if (exceptions.length === 0) return base;
  if (enabled)
    return `${base} · off in ${exceptions.length} ${exceptions.length === 1 ? "project" : "projects"}`;
  return `${base} · on in ${exceptions.length === 1 ? exceptions[0]?.name : `${exceptions.length} projects`}`;
}

/** With the default switched off, preview its configured skill set for editing. */
export function defaultSkillSet(state: PstackState): PstackState {
  return state.global.enabled ? state : configuredSkillSet(state);
}

/** Preview switching a following project On, including any saved overrides. */
export function projectOnSkillSet(state: PstackState): PstackState {
  return configuredSkillSet({
    ...state,
    project: {
      mode: "custom",
      enabled: true,
      skills: state.project?.skills ?? {},
    },
  });
}

function configuredSkillSet(state: PstackState): PstackState {
  const choices = new Map(
    state.resolved.map((skill) => [
      skill.id,
      (state.project?.mode === "custom"
        ? state.project.skills[skill.id]
        : undefined) ??
        state.global.skills[skill.id] ??
        (skill.isNew ? state.global.newSkillsDefault : "on"),
    ]),
  );
  const chosen = state.catalog.skills
    .filter((skill) => choices.get(skill.id) === "on")
    .map((skill) => skill.id);
  const active = new Set([
    ...chosen,
    ...dependencies(state.catalog.skills, chosen),
  ]);
  return {
    ...state,
    resolved: state.resolved.map((skill) => {
      const on = choices.get(skill.id) === "on";
      const required = !on && active.has(skill.id);
      const explicit =
        state.project === null
          ? state.global.skills[skill.id] !== undefined
          : state.project.mode === "custom" &&
            state.project.skills[skill.id] !== undefined;
      return {
        ...skill,
        active: active.has(skill.id),
        reason: required
          ? "on-required"
          : on
            ? explicit
              ? "on-explicit"
              : "on-inherited"
            : explicit
              ? "off-explicit"
              : "off-inherited",
        neededBy: required
          ? state.catalog.skills
              .filter(
                (user) =>
                  user.id !== skill.id &&
                  active.has(user.id) &&
                  dependencies(state.catalog.skills, [user.id]).includes(
                    skill.id,
                  ),
              )
              .map((user) => user.id)
          : [],
      };
    }),
  };
}
