import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Io } from "./cli";
import { SKILL_FILES, SKILL_NAME } from "./skill-files.generated";

/**
 * Where agent tools look for skills (folders with a SKILL.md):
 * - Claude Code: ~/.claude/skills, or .claude/skills in a project;
 * - Codex: $CODEX_HOME/skills (default ~/.codex/skills).
 * Anything else: pass a folder, and the skill is written to <folder>/vastitecture-modeling.
 */
export function skillTarget(target: string, project: boolean, cwd: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (target === "claude") return join(project ? join(cwd, ".claude") : join(home, ".claude"), "skills", SKILL_NAME);
  if (target === "codex") {
    if (project) throw new Error("Codex reads skills from your Codex home folder; run without --project, or pass a folder with --target <folder>");
    return join(env.CODEX_HOME || join(home, ".codex"), "skills", SKILL_NAME);
  }
  return join(resolve(cwd, target), SKILL_NAME);
}

export async function installSkill(opt: Record<string, string | true>, io: Io, home = homedir()): Promise<number> {
  const target = typeof opt.target === "string" ? opt.target : "claude";
  let dir: string;
  try {
    dir = skillTarget(target, opt.project === true, io.cwd, process.env, home);
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const differs: string[] = [];
  for (const [path, text] of Object.entries(SKILL_FILES)) {
    const current = await readFile(join(dir, path), "utf8").catch(() => undefined);
    if (current !== undefined && current !== text) differs.push(path);
  }
  if (differs.length && opt.force !== true) {
    io.err(`${dir} already has a different version of: ${differs.join(", ")}. Run again with --force to replace it.`);
    return 1;
  }
  for (const [path, text] of Object.entries(SKILL_FILES)) {
    const p = join(dir, path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, text);
  }
  io.err(`Installed the ${SKILL_NAME} skill (${Object.keys(SKILL_FILES).length} files) in ${dir}`);
  io.err("The skill runs `vastitecture` commands: put the CLI on your PATH, or keep vastitecture.mjs where the agent can find it.");
  return 0;
}
