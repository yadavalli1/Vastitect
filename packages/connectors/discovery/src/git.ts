import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, titleCase } from "./util";

const LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", py: "Python", go: "Go", java: "Java", kt: "Kotlin", kts: "Kotlin",
  cs: "C#", rb: "Ruby", rs: "Rust", php: "PHP", swift: "Swift", scala: "Scala", c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", ex: "Elixir", exs: "Elixir",
  clj: "Clojure", dart: "Dart", lua: "Lua", sql: "SQL", sh: "Shell", tf: "HCL", vue: "Vue", svelte: "Svelte", fs: "F#", hs: "Haskell", erl: "Erlang", r: "R",
};
const IGNORE = /(^|\/)(node_modules|vendor|dist|build|target|\.git|\.venv|venv|__pycache__|bin|obj)\//;

/** Dependencies declared in the common package manifests. */
function dependencies(f: ImportInput): string[] {
  const base = f.name.split("/").pop()!;
  const t = f.text;
  try {
    if (base === "package.json") {
      const j = JSON.parse(t);
      return Object.keys({ ...j.dependencies, ...j.peerDependencies });
    }
    if (base === "requirements.txt") return t.split("\n").map((l) => l.replace(/#.*/, "").trim().split(/[<>=!~;\[ ]/)[0]).filter(Boolean);
    if (base === "pyproject.toml") {
      const block = /\bdependencies\s*=\s*\[([\s\S]*?)\]/.exec(t)?.[1] ?? "";
      const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/.exec(t)?.[1] ?? "";
      return [...block.matchAll(/"([A-Za-z0-9_.-]+)/g)].map((m) => m[1]).concat([...poetry.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]).filter((x) => x !== "python"));
    }
    if (base === "go.mod") return [...t.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v[\d.]/gm)].map((m) => m[1]);
    if (base === "Cargo.toml") return [...(/\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(t)?.[1] ?? "").matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
    if (base === "pom.xml") return [...t.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map((m) => `${m[1]}:${m[2]}`);
    if (/^build\.gradle(\.kts)?$/.test(base)) return [...t.matchAll(/(?:implementation|api|compile)\s*\(?\s*["']([^:"']+:[^:"']+)/g)].map((m) => m[1]);
    if (base === "Gemfile") return [...t.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((m) => m[1]);
    if (base.endsWith(".csproj")) return [...t.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]);
    if (base === "composer.json") return Object.keys(JSON.parse(t).require ?? {}).filter((d) => d !== "php");
  } catch {
    /* unreadable manifest: reported below */
  }
  return [];
}

export const MANIFESTS = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|Gemfile|[^/]+\.csproj|composer\.json|catalog-info\.ya?ml|\.git\/config)$/;

/**
 * A repository folder becomes a link on an element: detected languages, declared dependencies and the
 * remote URL. Only file names are needed for languages; manifests are read for dependencies.
 */
export function discoverGit(files: ImportInput[], config: { element?: string; repo?: string } = {}): ModelPatch {
  const d = new Draft("git");
  const src = files.filter((f) => !IGNORE.test(f.name));
  const counts = new Map<string, number>();
  for (const f of src) {
    const lang = LANG[f.name.split(".").pop()!.toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const languages = [...counts].sort((a, b) => b[1] - a[1]).filter(([, n]) => n / total >= 0.05 || n >= 20).map(([l, n]) => `${l} ${Math.round((n / total) * 100)}%`);
  const deps = [...new Set(src.filter((f) => MANIFESTS.test(f.name)).flatMap(dependencies))].sort();
  const gitConfig = files.find((f) => /(^|\/)\.git\/config$/.test(f.name))?.text ?? "";
  const remote = config.repo || /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(gitConfig)?.[1];
  const href = remote?.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
  const top = files[0]?.name.split("/")[0] ?? "repository";
  const repoName = href?.split("/").pop() ?? (files.every((f) => f.name.startsWith(top + "/")) ? top : "repository");
  const name = config.element || titleCase(repoName);
  const el = d.element(`git:${href ?? repoName}`, "c4:Container", name, {
    properties: {
      ...(languages.length ? { languages, technology: languages[0].replace(/ \d+%$/, "") } : {}),
      ...(deps.length ? { dependencies: deps } : {}),
      repository: href ?? repoName,
    },
    links: href ? [{ kind: "repo", href }] : [],
  });
  void el;
  if (!total) d.report.push("No source files recognised: pick the repository's root folder");
  return d.patch(`Git repository ${repoName}: ${languages.join(", ") || "no languages detected"}; ${deps.length} declared dependencies`);
}
