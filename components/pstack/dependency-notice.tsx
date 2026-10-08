import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function DependencyNotice({
  ids,
  onDismiss,
}: {
  ids: string[];
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expanded) return;
    const timer = setTimeout(onDismiss, 12_000);
    return () => clearTimeout(timer);
  }, [ids, expanded, onDismiss]);
  if (ids.length === 0) return null;
  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <div
      role="status"
      className="mt-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <div>
        <p>
          Also turned on: {ids.length} {ids.length === 1 ? "skill" : "skills"}{" "}
          this selection uses ({shown.join(", ")}
          {extra > 0 ? `, +${extra} more` : ""}).
        </p>
        {extra > 0 && (
          <details
            className="mt-1"
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary className="cursor-pointer underline underline-offset-2">
              Show all {ids.length} skills
            </summary>
            <p className="mt-1 break-words">{ids.join(", ")}</p>
          </details>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1"
        aria-label="Dismiss dependency notice"
        onClick={onDismiss}
      >
        <Icon name="X" className="size-3.5" />
      </Button>
    </div>
  );
}
