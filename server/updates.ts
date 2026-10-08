import { z } from "zod";
import type { Catalog } from "../shared/catalog.ts";
import type { updateStatusSchema } from "../shared/rpc.ts";

export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type Fetch = typeof fetch;
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function initialUpdate(catalog: Catalog, version: string): UpdateStatus {
  return {
    bundledCommit: catalog.upstream.commit, bundledVersion: catalog.upstream.version,
    installedPluginVersion: version, latestUpstreamCommit: null, upstreamCommitsAhead: null,
    latestPluginVersion: null, checkedAt: null, error: null,
  };
}

/** One shared ten-second budget, including pagination and the release request. */
export async function fetchUpdates(catalog: Catalog, version: string, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<UpdateStatus> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("GitHub update check timed out after 10s")), 10_000);
  const result = initialUpdate(catalog, version);
  const errors: string[] = [];
  async function get(path: string, missingOk = false): Promise<unknown> {
    const response = await fetcher(`https://api.github.com${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "pstack-for-bb", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (missingOk && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
    return response.json();
  }
  try {
    await Promise.all([
      (async () => {
        try {
          let ahead = 0;
          for (let page = 1; page <= 100; page++) {
            const commits = z.array(z.object({ sha: z.string() })).parse(await get(`/repos/cursor/plugins/commits?sha=main&path=pstack&per_page=100&page=${page}`));
            if (page === 1) result.latestUpstreamCommit = commits[0]?.sha ?? null;
            const index = commits.findIndex(commit => commit.sha === catalog.upstream.commit);
            if (index >= 0) { result.upstreamCommitsAhead = ahead + index; return; }
            ahead += commits.length;
            if (commits.length < 100) break;
          }
          throw new Error("Bundled pstack commit was not found in upstream history; ahead count is unknown");
        } catch (error) { errors.push(errorMessage(error)); }
      })(),
      (async () => {
        try {
          // 404 means no visible release yet (none published, or the repo is
          // private). That's a normal state, not a failed check.
          const raw = await get("/repos/erikmackinnon/bb-plugin-pstack-for-bb/releases/latest", true);
          if (raw === null) return;
          const release = z.object({ tag_name: z.string() }).parse(raw);
          result.latestPluginVersion = release.tag_name.replace(/^v/u, "");
        } catch (error) { errors.push(errorMessage(error)); }
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  result.checkedAt = new Date().toISOString();
  result.error = errors.length ? errors.join("; ").slice(0, 2000) : null;
  return result;
}
