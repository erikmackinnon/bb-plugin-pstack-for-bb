import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { startBackend, type BackendOptions } from "./server/backend.ts";

export { rpcContract } from "./shared/rpc.ts";

/** Options are injectable for isolated tests; bb calls the factory with only bb. */
export default async function plugin(bb: BbPluginApi, options: BackendOptions = {}) {
  await startBackend(bb, options);
}
