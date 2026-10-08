import type { TurnOffPlan } from "./model";

export function DependencySummary({ plan }: { plan: TurnOffPlan }) {
  return (
    <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
      {plan.kept.map(({ id, users }) => (
        <li key={id}>
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-muted-foreground">
              <span className="font-medium text-foreground">{id}</span> — used
              by {users.length} {users.length === 1 ? "skill" : "skills"}
            </summary>
            <ul
              className="mt-2 flex flex-wrap gap-1.5"
              aria-label={`Skills that use ${id}`}
            >
              {users.map((user) => (
                <li
                  key={user}
                  className="rounded bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {user}
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
