import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, docs, titleCase, type J } from "./util";

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string; headers?: Record<string, string> }>;

/** One repository, from the GitHub REST API or from `gh repo list --json …`. */
export interface Repo {
  name: string;
  fullName: string;
  description?: string;
  language?: string;
  topics: string[];
  url: string;
  archived: boolean;
  codeowners?: string;
}

export const GH_FIELDS = "name,nameWithOwner,description,primaryLanguage,repositoryTopics,url,isArchived";

export function normaliseRepo(r: J): Repo | undefined {
  if (!r || typeof r.name !== "string") return undefined;
  const topics = Array.isArray(r.topics) ? r.topics : Array.isArray(r.repositoryTopics) ? r.repositoryTopics.map((t: J) => t?.name ?? t?.topic?.name ?? t) : [];
  return {
    name: r.name,
    fullName: r.full_name ?? r.nameWithOwner ?? r.name,
    description: r.description || undefined,
    language: r.language ?? r.primaryLanguage?.name ?? undefined,
    topics: topics.filter((t: unknown) => typeof t === "string"),
    url: r.html_url ?? r.url ?? "",
    archived: !!(r.archived ?? r.isArchived),
  };
}

/** Owners of the whole repository: the last `*` (or `/`) rule wins, as in GitHub itself; else the first rule. */
export function codeOwners(text: string): string[] {
  let all: string[] | undefined;
  let first: string[] | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    const clean = owners.map((o) => o.replace(/^@/, "")).filter(Boolean);
    first ??= clean;
    if (["*", "/", "/*", "/**", "**"].includes(pattern)) all = clean;
  }
  return all ?? first ?? [];
}

/**
 * Repositories become containers. A `system-<name>` topic groups repositories under a software system;
 * CODEOWNERS sets the owner; archived repositories are end of life. Other topics become tags.
 */
export function reposToPatch(repos: Repo[], source = "GitHub"): ModelPatch {
  const d = new Draft("github");
  const ungrouped: string[] = [];
  for (const r of repos) {
    const sys = r.topics.find((t) => /^system[-:]/.test(t));
    const parent = sys ? d.element(`github-system:${sys.replace(/^system[-:]/, "")}`, "c4:SoftwareSystem", titleCase(sys.replace(/^system[-:]/, ""))) : undefined;
    if (!parent) ungrouped.push(r.name);
    const owners = r.codeowners ? codeOwners(r.codeowners) : [];
    d.element(`github:${r.fullName.toLowerCase()}`, "c4:Container", r.name, {
      ...(parent ? { parent: parent.id } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(owners.length ? { owner: owners.join(", ") } : {}),
      ...(r.archived ? { lifecycle: { phase: "endOfLife" as const } } : {}),
      tags: r.topics.filter((t) => t !== sys),
      properties: { ...(r.language ? { technology: r.language } : {}), repository: r.fullName },
      links: r.url ? [{ kind: "repo" as const, label: "GitHub", href: r.url }] : [],
    });
  }
  const els = [...d.elements.values()];
  for (const sys of els.filter((e) => e.type === "c4:SoftwareSystem")) d.view("c4", "c4:container", `${sys.name} – repositories (${source})`, (e) => e === sys || e.parent === sys.id, undefined, sys);
  const loose = els.filter((e) => e.type === "c4:Container" && !e.parent);
  if (loose.length) d.view("c4", "c4:container", `Ungrouped repositories (${source})`, (e) => loose.includes(e));
  if (ungrouped.length) d.report.push(`${ungrouped.length} repository(ies) have no system-<name> topic and are not grouped under a system`);
  const noOwner = repos.filter((r) => !r.codeowners).length;
  if (noOwner) d.report.push(`${noOwner} repository(ies) have no CODEOWNERS file, so no owner was set`);
  return d.patch(`${source}: ${repos.length} repository(ies), ${repos.filter((r) => r.archived).length} archived`);
}

/** Files: `gh repo list ORG --json …` output (or REST API JSON); CODEOWNERS files named `<repo>.CODEOWNERS` or `<repo>/CODEOWNERS`. */
export function parseGithubFiles(files: ImportInput[], report: string[] = []): Repo[] {
  const repos: Repo[] = [];
  const owners = new Map<string, string>();
  for (const f of files) {
    const m = /(?:^|\/)([^/]+?)(?:\.|\/(?:\.github\/|docs\/)?)CODEOWNERS$/i.exec(f.name);
    if (m) {
      owners.set(m[1].toLowerCase(), f.text);
      continue;
    }
    for (const doc of docs(f, report)) for (const r of [doc].flat()) {
      const repo = normaliseRepo(r);
      if (repo) repos.push(repo);
    }
  }
  for (const r of repos) r.codeowners = owners.get(r.name.toLowerCase()) ?? owners.get(r.fullName.toLowerCase());
  return repos;
}

/** Live: every repository of an organisation or user, with its CODEOWNERS file. */
export async function fetchGithub(fetch: Fetch, o: { org: string; token?: string; includeArchived?: boolean; limit?: number }): Promise<Repo[]> {
  const org = o.org.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(org)) throw new Error("Enter an organisation or user name, e.g. acme");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) };
  const get = async (url: string) => {
    const res = await fetch(url, { headers });
    if (res.status === 401) throw new Error("GitHub rejected the token");
    if (res.status === 403 && /rate limit/i.test(res.text)) throw new Error("GitHub's rate limit was reached. Add a token (read-only, metadata and contents) to raise it.");
    return res;
  };
  const repos: Repo[] = [];
  const limit = o.limit ?? 500;
  for (const kind of ["orgs", "users"]) {
    for (let page = 1; repos.length < limit; page++) {
      const res = await get(`https://api.github.com/${kind}/${org}/repos?per_page=100&page=${page}&sort=full_name`);
      if (res.status === 404) break;
      if (res.status >= 400) throw new Error(`GitHub answered ${res.status}: ${res.text.slice(0, 200)}`);
      const batch = (JSON.parse(res.text) as J[]).map(normaliseRepo).filter((r): r is Repo => !!r && (o.includeArchived !== false || !r.archived));
      repos.push(...batch);
      if (JSON.parse(res.text).length < 100) break;
    }
    if (repos.length) break;
  }
  if (!repos.length) throw new Error(`No repositories found for ${org} (or the token cannot see them)`);
  for (const r of repos.slice(0, limit)) {
    for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
      const res = await get(`https://api.github.com/repos/${r.fullName}/contents/${path}`);
      if (res.status !== 200) continue;
      const body = JSON.parse(res.text) as J;
      r.codeowners = body.encoding === "base64" ? atob(String(body.content).replace(/\s/g, "")) : String(body.content ?? "");
      break;
    }
  }
  return repos.slice(0, limit);
}
