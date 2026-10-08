import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Toggle } from "./controls";
import { newerRelease } from "./model";
import type { PstackState } from "./model";

export const UPDATE_COMMAND = "bb plugin update pstack-for-bb";
export function StatusCard({
  state,
  pending,
  onCheck,
  onDefault,
}: {
  state: PstackState;
  pending: boolean;
  onCheck: () => void;
  onDefault: (on: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const update = state.update;
  const newer = newerRelease(
    update.latestPluginVersion,
    update.installedPluginVersion,
  );
  const commit = update.bundledCommit;
  const date = state.catalog.upstream.committedAt.slice(0, 10);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError("Couldn't copy. Select and copy the command above.");
    }
  };
  return (
    <Card className="mt-6 space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            Bundled pstack {update.bundledVersion}
          </h2>
          <p className="text-xs text-muted-foreground">
            <a
              className="underline underline-offset-2"
              href={`https://github.com/cursor/plugins/commit/${commit}`}
              target="_blank"
              rel="noreferrer"
            >
              {commit.slice(0, 8)}
            </a>{" "}
            · {date} · Plugin {update.installedPluginVersion}
          </p>
          <p className="text-sm">
            {update.upstreamCommitsAhead === null
              ? "Upstream status hasn't been checked yet."
              : update.upstreamCommitsAhead === 0
                ? "Up to date with upstream"
                : `Upstream is ${update.upstreamCommitsAhead} ${update.upstreamCommitsAhead === 1 ? "commit" : "commits"} ahead`}
          </p>
          {update.checkedAt && (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(update.checkedAt).toLocaleString()}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCheck}
          disabled={pending}
        >
          <Icon name="RefreshCw" className="size-3.5" />
          Check now
        </Button>
      </div>
      {update.error && (
        <p role="status" className="text-xs text-muted-foreground">
          Couldn't check for updates: {update.error}
        </p>
      )}
      {newer && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm">
            Plugin {update.latestPluginVersion} is available. Update to receive
            the latest mirrored skills.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="select-all break-all text-xs">
              {UPDATE_COMMAND}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void copy();
              }}
              aria-label="Copy plugin update command"
            >
              <Icon name={copied ? "Check" : "Copy"} className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {copyError && (
            <p role="alert" className="text-xs text-destructive">
              {copyError}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm">
            New skills from upstream start:{" "}
            <strong>
              {state.global.newSkillsDefault === "on" ? "On" : "Off"}
            </strong>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Applies globally when new skills arrive in a plugin update.
          </p>
        </div>
        <Toggle
          checked={state.global.newSkillsDefault === "on"}
          label="New skills from upstream start on"
          disabled={pending}
          onChange={onDefault}
        />
      </div>
    </Card>
  );
}
