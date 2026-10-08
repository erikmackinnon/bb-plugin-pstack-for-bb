import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export function StartHere({
  dismissed,
  pending,
  onDismiss,
}: {
  dismissed: boolean;
  pending: boolean;
  onDismiss: () => void;
}) {
  if (dismissed) return null;
  return (
    <Card className="mt-4 space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Start here</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Lauren&apos;s recommended way in:
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={pending}
          aria-label="Dismiss getting started"
          onClick={onDismiss}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
            /poteto-mode
          </code>{" "}
          at the start of any task that needs rigor. It picks a playbook and
          runs the other skills for you.
        </li>
        <li>
          Optional: run{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            /setup-pstack
          </code>{" "}
          once to choose which models pstack uses for each role. Without it,
          pstack picks from the models you have.
          <p className="mt-1 text-xs text-muted-foreground">
            This saves model choices directly to the pstack-models section of
            bb&apos;s user agent instructions. See the{" "}
            <a
              href="https://github.com/erikmackinnon/bb-plugin-pstack-for-bb/blob/main/COMPATIBILITY.md"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              compatibility notes
            </a>
            .
          </p>
        </li>
        <li>
          Stuck or not sure which skill fits? Ask{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            /poteto-help
          </code>
          , or read Lauren&apos;s{" "}
          <a
            href="https://github.com/cursor/plugins/tree/main/pstack/docs/guide"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            pstack guide
          </a>
          .
        </li>
      </ol>
      <p className="text-xs text-muted-foreground">
        In Cursor, /poteto-mode can stay on across turns as a custom mode. bb
        doesn&apos;t have that, so start each task with /poteto-mode.
      </p>
    </Card>
  );
}
