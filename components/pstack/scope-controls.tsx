import { Button } from "@/components/ui/button";
import { Toggle } from "./controls";
import { projectChoice } from "./model";
import type { ProjectChoice, PstackState, Scope } from "./model";

export function ScopeControls({
  scope,
  state,
  pending,
  onDefault,
  onProject,
}: {
  scope: Scope;
  state: PstackState;
  pending: boolean;
  onDefault: (enabled: boolean) => void;
  onProject: (choice: ProjectChoice) => void;
}) {
  const selection = projectChoice(state.project);
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h2 className="text-sm font-medium">
        {scope.kind === "global"
          ? "Default for all projects"
          : "pstack in this project"}
      </h2>
      {scope.kind === "global" ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">Turn on pstack in every project</p>
            <Toggle
              checked={state.global.enabled}
              label="Turn on pstack in every project"
              disabled={pending}
              onChange={onDefault}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Projects can override this. Leave it off to turn pstack on only in
            the projects you choose.
          </p>
        </>
      ) : (
        <>
          <div
            className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1"
            role="group"
            aria-label="pstack in this project"
          >
            {(["inherit", "on", "off"] as const).map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={selection === choice ? "secondary" : "ghost"}
                aria-pressed={selection === choice}
                disabled={pending}
                onClick={() => onProject(choice)}
              >
                {choice === "inherit"
                  ? `Use default (${state.global.enabled ? "On" : "Off"})`
                  : choice === "on"
                    ? "On"
                    : "Off"}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selection === "inherit"
              ? "Follows the default for all projects."
              : selection === "on"
                ? "pstack is on here. Skill choices start from the default set; changes below apply only to this project."
                : "pstack is off in this project."}
          </p>
        </>
      )}
    </div>
  );
}
