import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogSchema, type Catalog } from "../shared/catalog.ts";

/** Works from both the source entry and dist/server.js; never depends on cwd. */
export async function findPluginRoot(start = dirname(fileURLToPath(import.meta.url))): Promise<string> {
  let directory = start;
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name === "bb-plugin-pstack-for-bb") return directory;
    } catch { /* Continue toward the root. */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate pstack-for-bb package.json");
    directory = parent;
  }
}

export async function loadCatalog(path: string): Promise<Catalog> {
  const catalog = catalogSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const skill of catalog.skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(skill.id) || !skill.bbName.trim()) throw new Error(`Invalid skill identity: ${skill.id}`);
    if (ids.has(skill.id) || names.has(skill.bbName)) throw new Error(`Duplicate skill identity: ${skill.id}`);
    ids.add(skill.id);
    names.add(skill.bbName);
  }
  for (const skill of catalog.skills) {
    if (skill.requires.some(id => !ids.has(id))) throw new Error(`Unknown dependency in ${skill.id}`);
  }
  if (catalog.skills.length > 256) throw new Error("Catalog exceeds bb's 256 selected skills limit");
  return catalog;
}

const ATTRIBUTION = "pstack skills by Lauren Tan (MIT), via cursor/plugins";
export async function loadRuntimeNote(path: string): Promise<string | null> {
  let note: string;
  try { note = (await readFile(path, "utf8")).trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return note ? `${ATTRIBUTION}\n${note}`.slice(0, 4096) : null;
}

/** Match generated names to the actual manifest skill frontmatter, fail safely. */
export async function registeredSkillNames(root: string, catalog: Catalog): Promise<Set<string>> {
  const names = await Promise.all(catalog.skills.map(async skill => {
    try {
      const text = await readFile(join(root, "pstack", "skills", skill.id, "SKILL.md"), "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
      const raw = /^name:\s*(.+?)\s*$/mu.exec(frontmatter ?? "")?.[1];
      const name = raw?.replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
      return name === skill.bbName ? name : null;
    } catch { return null; }
  }));
  return new Set(names.filter((name): name is string => name !== null));
}

/** Presence on the server's PATH. No shell, execution, or global settings writes. */
export async function detectPrerequisites(path = process.env.PATH ?? ""): Promise<Record<string, boolean>> {
  const tools = ["bun", "gh", "git", "node"];
  const entries = path.split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return Object.fromEntries(await Promise.all(tools.map(async tool => {
    for (const entry of entries) for (const extension of extensions) {
      try {
        const candidate = join(entry, `${tool}${extension}`);
        await access(candidate, constants.X_OK);
        if ((await stat(candidate)).isFile()) return [tool, true];
      }
      catch { /* Try the next PATH entry. */ }
    }
    return [tool, false];
  })));
}
