import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { rpcContract } from "../shared/rpc.ts";
import type { Scope } from "./resolve.ts";
import { errorMessage } from "./updates.ts";

const commandUsage = {
  status: "bb pstack-for-bb status [--json]",
  list: "bb pstack-for-bb list [--project <id>] [--json]",
  enable: "bb pstack-for-bb enable <id...> [--project <id>] [--json]",
  disable: "bb pstack-for-bb disable <id...> [--project <id>] [--cascade] [--json]",
  inherit: "bb pstack-for-bb inherit --project <id> [--json]",
  "check-updates": "bb pstack-for-bb check-updates [--json]",
};
const usage = `Usage:\n${Object.values(commandUsage).map(line => `  ${line}`).join("\n")}`;

export function registerCli(bb: BbPluginApi, handlers: PluginRpcHandlers<typeof rpcContract>) {
  const summaries = { status: "Show plugin and update status", list: "List resolved pstack skills", enable: "Choose skills to enable", disable: "Disable skills, optionally cascading to dependents", inherit: "Make a project use the global settings again", "check-updates": "Check GitHub for upstream commits and plugin releases" };
  bb.cli.register({
    name: "pstack-for-bb", summary: "Manage Lauren Tan's pstack skills globally or per project",
    commands: Object.entries(commandUsage).map(([name, command]) => ({ name, summary: summaries[name as keyof typeof summaries], usage: command })),
    async run(argv) {
      const json = argv.includes("--json");
      const reply = (value: unknown, text: string) => ({ exitCode: 0, stdout: json ? JSON.stringify(value) : text });
      try {
        const [command, ...args] = argv;
        if (command === undefined || command === "help" || command === "--help") return { exitCode: 0, stdout: usage };
        if (!Object.hasOwn(commandUsage, command)) throw new Error(usage);
        let scope: Scope = { kind: "global" };
        let cascade = false;
        const ids: string[] = [];
        for (let index = 0; index < args.length; index++) {
          const arg = args[index];
          if (arg === "--json") continue;
          if (arg === "--project") {
            const projectId = args[++index];
            if (!projectId || projectId.startsWith("--") || scope.kind === "project") throw new Error("--project requires one project id");
            scope = { kind: "project", projectId };
          } else if (arg === "--cascade") cascade = true;
          else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
          else ids.push(arg);
        }
        if (cascade && command !== "disable") throw new Error("--cascade is only valid with disable");
        if ((command === "status" || command === "check-updates") && scope.kind === "project") throw new Error(`--project is not valid with ${command}`);
        if (command === "inherit" && scope.kind !== "project") throw new Error(commandUsage.inherit);
        if ((command === "enable" || command === "disable") ? ids.length === 0 : ids.length !== 0) throw new Error(commandUsage[command as keyof typeof commandUsage]);
        switch (command) {
          case "status": {
            const state = await handlers.pstack_state({ scope });
            return reply(state, `pstack for bb ${state.update.installedPluginVersion}\nBundled pstack ${state.update.bundledVersion} @ ${state.update.bundledCommit}\nMaster: ${state.global.enabled ? "on" : "off"}; active skills: ${state.resolved.filter(skill => skill.active).length}/${state.resolved.length}\nLatest plugin: ${state.update.latestPluginVersion ?? "unknown"}; upstream commits ahead: ${state.update.upstreamCommitsAhead ?? "unknown"}${state.update.error ? `\nUpdate error: ${state.update.error}` : ""}`);
          }
          case "list": {
            const state = await handlers.pstack_state({ scope });
            return reply(state.resolved, state.resolved.map(skill => `${skill.active ? "on " : "off"} ${skill.id} (${skill.reason}${skill.neededBy.length ? `; needed by ${skill.neededBy.join(", ")}` : ""})`).join("\n"));
          }
          case "enable":
          case "disable": {
            const result = await handlers.pstack_set_skills({ scope, changes: ids.map(id => ({ id, value: command === "enable" ? "on" as const : "off" as const })), cascade });
            return reply(result, result.resolved.map(skill => `${skill.active ? "on " : "off"} ${skill.id} (${skill.reason})`).join("\n"));
          }
          case "inherit": {
            if (scope.kind !== "project") throw new Error(commandUsage.inherit);
            await handlers.pstack_set_project_mode({ projectId: scope.projectId, mode: "inherit" });
            return reply({ ok: true }, `Project ${scope.projectId} now uses the global pstack settings.`);
          }
          case "check-updates": {
            const result = await handlers.pstack_check_updates(null);
            return reply(result, `Latest pstack commit: ${result.latestUpstreamCommit ?? "unknown"}\nUpstream commits ahead: ${result.upstreamCommitsAhead ?? "unknown"}\nLatest plugin: ${result.latestPluginVersion ?? "unknown"}${result.error ? `\nUpdate error: ${result.error}` : ""}`);
          }
        }
        throw new Error(usage);
      } catch (error) {
        return { exitCode: 1, stderr: json ? JSON.stringify({ error: errorMessage(error) }) : errorMessage(error) };
      }
    },
  });
}
