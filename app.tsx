import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./shared/rpc";
import { STATE_CHANGED } from "./shared/events";
import { SKILL_GROUPS } from "./shared/catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "./components/pstack/controls";
import { SkillRow } from "./components/pstack/skill-row";
import { StatusCard } from "./components/pstack/status";
import {
  planTurnOff,
  turnOffCopy,
  dependencies,
  GROUP_LABELS,
  projectChoice,
  projectSuffix,
  activitySummary,
  defaultSkillSet,
  projectOnSkillSet,
} from "./components/pstack/model";
import type { PstackState, Scope } from "./components/pstack/model";

import { DependencyNotice } from "./components/pstack/dependency-notice";
import { DependencySummary } from "./components/pstack/dependency-summary";
import { ScopeControls } from "./components/pstack/scope-controls";
import { StartHere } from "./components/pstack/start-here";
const GLOBAL: Scope = { kind: "global" };

/** Keyed by scope so responses and dialogs never bleed into another project. */
function ScopePage({
  scope,
  selectScope,
  onProjects,
  onCommit,
  projects,
}: {
  scope: Scope;
  selectScope: (scope: Scope) => void;
  onProjects: (projects: PstackState["projects"]) => void;
  onCommit: (commit: string) => void;
  projects: PstackState["projects"];
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<PstackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [turnOff, setTurnOff] = useState<string[] | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const revision = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const report = useCallback((cause: unknown) => {
    if (mounted.current)
      setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await rpc.call("pstack_state", { scope });
      if (mounted.current && revision.current === request) {
        setState(next);
        setLoadError(null);
        onProjects(next.projects);
        onCommit(next.catalog.upstream.commit);
      }
    } catch (cause) {
      if (mounted.current && revision.current === request)
        setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc, scope, onProjects, onCommit]);
  useEffect(() => {
    mounted.current = true;
    void refetch();
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, [refetch]);
  useRealtime(STATE_CHANGED, refetch);
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (
      connection === "connected" &&
      previousConnection.current !== "connected"
    )
      void refetch();
    previousConnection.current = connection;
  }, [connection, refetch]);

  const mutate = async (action: () => Promise<unknown>, after?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      if (mounted.current) after?.();
      await refetch();
    } catch (cause) {
      report(cause);
      await refetch();
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const dismissIncluded = useCallback(() => setIncluded([]), []);
  const setSkills = (ids: string[], enabled: boolean, cascade = false) => {
    if (!state) return;
    const active = new Set(
      (skillState ?? state).resolved
        .filter((skill) => skill.active)
        .map((skill) => skill.id),
    );
    const autoIncluded = enabled
      ? dependencies(state.catalog.skills, ids).filter((id) => !active.has(id))
      : [];
    void mutate(
      async () => {
        const result = await rpc.call("pstack_set_skills", {
          scope,
          changes: ids.map((id) => ({ id, value: enabled ? "on" : "off" })),
          cascade,
        });
        if (mounted.current) setTurnOff(null);
        if (
          scope.kind === "project" &&
          state.project?.mode === "inherit" &&
          !state.project.enabled
        ) {
          try {
            await rpc.call("pstack_set_master", { scope, enabled: true });
          } catch (cause) {
            const detail =
              cause instanceof Error ? cause.message : String(cause);
            throw new Error(
              `Skill choices saved, but couldn't turn this project on. Choose On to retry. ${detail}`,
            );
          }
        }
        return result;
      },
      () => {
        setIncluded(autoIncluded);
        setTurnOff(null);
      },
    );
  };
  const requestToggle = (ids: string[], enabled: boolean) => {
    if (!state || pending) return;
    const plan = enabled ? null : planTurnOff(editState ?? state, ids);
    if (plan && plan.kept.length > 0) {
      setError(null);
      setTurnOff(plan.ids);
    } else setSkills(ids, enabled);
  };
  const inherited =
    scope.kind === "project" && state?.project?.mode !== "custom";
  const editsDefault = scope.kind === "global" || inherited;
  const skillState = state && editsDefault ? defaultSkillSet(state) : state;
  const editState = state && inherited ? projectOnSkillSet(state) : skillState;
  const turnOffPlan =
    editState && turnOff ? planTurnOff(editState, turnOff) : null;
  const dialogCopy = turnOffPlan ? turnOffCopy(turnOffPlan) : null;
  const disabled =
    pending ||
    (scope.kind === "project" &&
      !inherited &&
      projectChoice(state?.project ?? null) === "off");
  const query = search.trim().toLocaleLowerCase();
  const skills =
    state?.catalog.skills.filter((skill) =>
      `${skill.displayName} ${skill.id} ${skill.description}`
        .toLocaleLowerCase()
        .includes(query),
    ) ?? [];
  const resolved = new Map(
    skillState?.resolved.map((skill) => [skill.id, skill]) ?? [],
  );
  const newCount = state?.resolved.filter((skill) => skill.isNew).length ?? 0;
  const scopeValue =
    scope.kind === "global" ? "global" : `project:${scope.projectId}`;

  return (
    <>
      {state && (
        <p className="mt-3 text-xs text-muted-foreground">
          {activitySummary(state)}
        </p>
      )}
      {state && (
        <StartHere
          dismissed={state.startHereDismissed}
          pending={pending}
          onDismiss={() => {
            void mutate(() =>
              rpc.call("pstack_dismiss_start_here", { dismissed: true }),
            );
          }}
        />
      )}
      <Card className="mt-5 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="pstack-scope" className="text-sm font-medium">
            Scope
          </label>
          <select
            id="pstack-scope"
            value={scopeValue}
            disabled={pending}
            onChange={(event) =>
              selectScope(
                event.target.value === "global"
                  ? GLOBAL
                  : { kind: "project", projectId: event.target.value.slice(8) },
              )
            }
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="global">
              Default for all projects · {state?.global.enabled === false ? "off" : "on"}
            </option>
            {projects.map((item) => (
              <option key={item.id} value={`project:${item.id}`}>
                {item.name}
                {` · ${projectSuffix(item)}`}
              </option>
            ))}
          </select>
        </div>
        {state && (
          <ScopeControls
            scope={scope}
            state={state}
            pending={pending}
            onDefault={(enabled) => {
              void mutate(() =>
                rpc.call("pstack_set_master", { scope: GLOBAL, enabled }),
              );
            }}
            onProject={(choice) => {
              if (scope.kind !== "project") return;
              void mutate(() =>
                choice === "inherit"
                  ? rpc.call("pstack_set_project_mode", {
                      projectId: scope.projectId,
                      mode: "inherit",
                    })
                  : rpc.call("pstack_set_master", {
                      scope,
                      enabled: choice === "on",
                    }),
              );
            }}
          />
        )}
      </Card>
      {(error || loadError) && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          <span>{error || loadError}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              setLoadError(null);
              void refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {!state ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
        >
          {loadError
            ? "Unable to load pstack settings."
            : "Loading pstack settings…"}
        </p>
      ) : (
        <>
          <h2 className="mt-5 text-sm font-medium">
            {editsDefault ? "Default skill set" : "Skills for this project"}
          </h2>
          {inherited && (
            <p className="mt-1 text-xs text-muted-foreground">
              Choose On to customize skills for this project. Editing a skill
              also switches this project to On.
              {Object.keys(state.project?.skills ?? {}).length > 0 &&
                " Your saved project skill choices will be restored when you choose On or edit a skill."}
            </p>
          )}
          {scope.kind === "global" && (
            <p className="mt-1 text-xs text-muted-foreground">
              These choices are the default skill set, even when pstack is off
              by default.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCollapsed(new Set());
              }}
              aria-label="Search skills"
              placeholder="Search skills…"
              className="min-w-0 flex-1"
            />
            <span className="text-xs text-muted-foreground">
              {skillState?.resolved.filter((skill) => skill.active).length} /{" "}
              {state.catalog.skills.length}{" "}
              {editsDefault ? "in default set" : "active"}
            </span>
            {newCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  void mutate(() => rpc.call("pstack_mark_seen", null));
                }}
              >
                Dismiss {newCount} New {newCount === 1 ? "badge" : "badges"}
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Start pstack skills as slash commands — /poteto-mode is the main
            entry point and routes to the rest.
          </p>
          {included.length > 0 && (
            <DependencyNotice
              key={included.join(",")}
              ids={included}
              onDismiss={dismissIncluded}
            />
          )}
          <div
            className={`mt-4 space-y-3 ${inherited ? "opacity-70" : ""}`}
            aria-busy={pending}
          >
            {SKILL_GROUPS.map((group) => {
              const groupSkills = skills.filter(
                (skill) => skill.group === group,
              );
              if (groupSkills.length === 0) return null;
              const count = groupSkills.filter(
                (skill) => resolved.get(skill.id)?.active,
              ).length;
              const allOn = count === groupSkills.length;
              const closed = collapsed.has(group);
              return (
                <Card key={group}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 justify-start px-0 py-1"
                      aria-expanded={!closed}
                      aria-controls={`pstack-group-${group}`}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(group)) next.delete(group);
                          else next.add(group);
                          return next;
                        })
                      }
                    >
                      <Icon
                        name={closed ? "ChevronRight" : "ChevronDown"}
                        className="size-4 shrink-0"
                      />
                      <span className="truncate">{GROUP_LABELS[group]}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {count}/{groupSkills.length}
                      </span>
                    </Button>
                    <Checkbox
                      checked={
                        allOn ? true : count > 0 ? "indeterminate" : false
                      }
                      disabled={disabled}
                      aria-label={`${allOn ? "Disable" : "Enable"} ${GROUP_LABELS[group]}${query ? " matching search" : ""}`}
                      onCheckedChange={() =>
                        requestToggle(
                          groupSkills.map((skill) => skill.id),
                          !allOn,
                        )
                      }
                    />
                  </div>
                  <ul
                    hidden={closed}
                    id={`pstack-group-${group}`}
                    className="divide-y divide-border border-t border-border px-4"
                  >
                    {groupSkills.map((skill) => {
                      const item = resolved.get(skill.id);
                      return item ? (
                        <SkillRow
                          key={skill.id}
                          skill={skill}
                          resolved={item}
                          state={state}
                          disabled={disabled}
                          onToggle={(enabled) =>
                            requestToggle([skill.id], enabled)
                          }
                          onReset={() => {
                            void mutate(
                              () =>
                                rpc.call("pstack_set_skills", {
                                  scope,
                                  changes: [{ id: skill.id, value: null }],
                                  cascade: false,
                                }),
                              () => setIncluded([]),
                            );
                          }}
                        />
                      ) : null;
                    })}
                  </ul>
                </Card>
              );
            })}
            {skills.length === 0 && (
              <p
                role="status"
                className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
              >
                No skills match “{search}”.
              </p>
            )}
          </div>
          {query && (
            <p className="mt-2 text-xs text-muted-foreground">
              Group toggles apply to skills matching this search.
            </p>
          )}
          <StatusCard
            state={state}
            pending={pending}
            onCheck={() => {
              void mutate(() => rpc.call("pstack_check_updates", null));
            }}
            onDefault={(on) => {
              void mutate(() =>
                rpc.call("pstack_set_new_skills_default", {
                  value: on ? "on" : "off",
                }),
              );
            }}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Changes apply to new agent sessions.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Plugin maintained by erikmackinnon ·{" "}
            <a
              href="https://github.com/erikmackinnon"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              GitHub
            </a>{" "}
            ·{" "}
            <a
              href="https://x.com/erikmackinnon"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              X
            </a>{" "}
            ·{" "}
            <a
              href="https://github.com/erikmackinnon/bb-plugin-pstack-for-bb/issues"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Report a plugin issue
            </a>{" "}
            ·{" "}
            <button
              type="button"
              disabled={pending}
              className="rounded-sm text-xs underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              onClick={() => {
                void mutate(() =>
                  rpc.call("pstack_dismiss_start_here", { dismissed: false }),
                );
              }}
            >
              Getting started
            </button>
          </p>
        </>
      )}
      <Dialog
        open={turnOff !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setTurnOff(null);
        }}
      >
        <DialogContent hideCloseButton={pending}>
          <DialogHeader>
            <DialogTitle>{dialogCopy?.title}</DialogTitle>
            <DialogDescription>{dialogCopy?.body}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {turnOffPlan && <DependencySummary plan={turnOffPlan} />}
          <DialogFooter className="sm:flex-wrap">
            <Button
              variant="outline"
              className="h-auto whitespace-normal py-2"
              disabled={pending}
              onClick={() => {
                if (turnOff) setSkills(turnOff, false, false);
              }}
            >
              {dialogCopy?.keep}
            </Button>
            <Button
              variant="destructive"
              className="h-auto whitespace-normal py-2"
              disabled={pending}
              onClick={() => {
                if (turnOff) setSkills(turnOff, false, true);
              }}
            >
              {dialogCopy?.cascade}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PstackPage() {
  const [scope, setScope] = useState<Scope>(GLOBAL);
  const [commit, setCommit] = useState<string | null>(null);
  const [projects, setProjects] = useState<PstackState["projects"]>([]);
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto text-foreground">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-6 pt-4 md:px-5">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            pstack for bb
          </h1>
          <p className="text-sm text-muted-foreground">
            Lauren Tan&apos;s pstack skill set, synced daily from cursor/plugins
            and adapted only where Cursor locations don&apos;t exist in bb.
          </p>
          <p className="text-sm text-muted-foreground">
            Skill folders, model settings, and past chats use bb locations.
            Her workflows, playbooks, principles, and wording otherwise stay
            as written. See the{" "}
            <a
              className="underline underline-offset-2"
              href="https://github.com/erikmackinnon/bb-plugin-pstack-for-bb/blob/main/COMPATIBILITY.md"
              target="_blank"
              rel="noreferrer"
            >
              compatibility notes
            </a>{" "}
            for every mechanical change.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Unofficial mirror · skills © Lauren Tan · MIT</Badge>
            <a
              className="text-xs text-muted-foreground underline underline-offset-2"
              href="https://github.com/cursor/plugins/tree/main/pstack"
              target="_blank"
              rel="noreferrer"
            >
              Original pstack
            </a>
            {commit && (
              <a
                className="text-xs text-muted-foreground underline underline-offset-2"
                href={`https://github.com/cursor/plugins/commit/${commit}`}
                target="_blank"
                rel="noreferrer"
              >
                Upstream commit {commit.slice(0, 8)}
              </a>
            )}
          </div>
        </header>
        <ScopePage
          key={scope.kind === "global" ? "global" : scope.projectId}
          scope={scope}
          selectScope={setScope}
          projects={projects}
          onProjects={setProjects}
          onCommit={setCommit}
        />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "pstack",
    title: "pstack for bb",
    icon: "Layers",
    path: "pstack",
    component: PstackPage,
  });
});
