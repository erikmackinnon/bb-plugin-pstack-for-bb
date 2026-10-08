import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Badge, Hint, Toggle } from "./controls";
import { differsFromGlobal, keptOnText, secondaryName } from "./model";
import type { PstackState, ResolvedSkill } from "./model";
import type { CatalogSkill } from "../../shared/catalog";

export function SkillRow({
  skill,
  resolved,
  state,
  disabled,
  onToggle,
  onReset,
}: {
  skill: CatalogSkill;
  resolved: ResolvedSkill;
  state: PstackState;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Only clamped descriptions are clickable; short ones have nothing to expand.
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const node = descriptionRef.current;
    if (!node || expanded) return;
    const measure = () => setTruncated(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [expanded, skill.description]);
  const expandable = expanded || truncated;
  const descriptionId = useId();
  const required = resolved.reason === "on-required";
  const displayName = secondaryName(skill);
  const keptDescriptionId = useId();
  const missing = skill.prerequisites.filter(
    (name) => state.prerequisites[name] === false,
  );
  const overridden = differsFromGlobal(state, skill);
  return (
    <li className="flex items-start gap-3 py-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">/{skill.id}</span>
          {displayName && (
            <span className="text-xs text-muted-foreground">{displayName}</span>
          )}
          {resolved.isNew && <Badge>New</Badge>}
          {!skill.userInvocableOnly && (
            <Badge>Agents can use this on their own</Badge>
          )}
          {missing.map((name) => (
            <Hint
              key={name}
              text={`${name} is missing on the server machine. Install it on the machine running the skill's helpers.`}
            >
              <Badge>
                Needs {name}
                {name === "bun" ? "" : " · missing"}
              </Badge>
            </Hint>
          ))}
          {overridden && <Badge>Project override</Badge>}
        </div>
        <p
          id={descriptionId}
          ref={descriptionRef}
          {...(expandable
            ? {
                role: "button",
                tabIndex: 0,
                "aria-expanded": expanded,
                title: expanded ? "Show less" : "Show full description",
                onClick: () => setExpanded(!expanded),
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpanded(!expanded);
                  }
                },
              }
            : {})}
          className={`whitespace-pre-wrap break-words text-sm text-muted-foreground ${expanded ? "" : "line-clamp-2"} ${expandable ? "cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" : ""}`}
        >
          {skill.description}
        </p>
        {required && (
          <p
            id={keptDescriptionId}
            className="text-xs text-muted-foreground"
            title={`Used by ${resolved.neededBy.join(", ") || "active skills"}`}
          >
            {keptOnText(resolved.neededBy)}
          </p>
        )}
        {state.project?.mode === "custom" &&
          state.project.skills[skill.id] !== undefined && (
            <Button
              disabled={disabled}
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-muted-foreground"
              onClick={onReset}
            >
              Use default choice
            </Button>
          )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {required && (
          <Icon name="Lock" className="size-3.5 text-muted-foreground" />
        )}
        <Toggle
          checked={resolved.active}
          label={
            required
              ? `Review turning off /${skill.id}, kept on by other skills`
              : `Enable /${skill.id}`
          }
          disabled={disabled}
          locked={required}
          describedBy={required ? keptDescriptionId : undefined}
          onChange={onToggle}
        />
      </div>
    </li>
  );
}
