// SDK-free constants shared by server.ts and app.tsx. The app bundle may import
// this module at runtime; keep it free of @get-bb/plugin-sdk and server code.

/** Realtime channel: published after any state change so open pages refetch. */
export const STATE_CHANGED = "pstack-state-changed";
