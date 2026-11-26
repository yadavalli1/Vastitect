# AI agents: create and change models

AI agents can build Vastitecture models for you: Claude Code, Codex, Cursor, Gemini CLI, Claude Desktop
or anything else that can run a command or use MCP. Describe a system, paste a design document or point
the agent at a repository, and it writes a model you can open in the app.

There are three parts:

| Part | What it is | For |
| --- | --- | --- |
| **The skill** (`skills/vastitecture-modeling`) | A `SKILL.md` with a spec format reference, a modelling guide, the notation vocabulary and examples. | Agents that load skills (Claude Code, Codex, and others that read `SKILL.md`). Other agents can be pointed at the file. |
| **The CLI** (`vastitecture`) | `types`, `show`, `apply`, `check`, `export` and `new`. | Any agent that can run shell commands. |
| **The MCP server** (`vastitecture mcp`) | The same commands as MCP tools. | Chat apps and editors that use MCP: Claude Desktop, Cursor, Codex, Claude Code. |

Agents never write workspace YAML directly. They write a **model spec** that names elements,
relationships and views. `vastitecture apply` checks it against the notation packs, merges it into the
workspace, lays the views out and runs validation and the workspace's rules. A spec with mistakes is
refused, and the error names the valid choices, so the agent can correct itself. See
[the spec format](../skills/vastitecture-modeling/reference/spec-format.md).

## 1. Get the CLI

- **From a release:** download `vastitecture.mjs` from the latest GitHub release. It is a single file
  and runs on Node 20 or later: `node vastitecture.mjs help`. To have it on your PATH on macOS or
  Linux, save it as `/usr/local/bin/vastitecture` and `chmod +x` it.
- **From a checkout:** `pnpm install && pnpm --filter @vastitecture/cli build`, then
  `node packages/cli/dist/vastitecture.mjs`.

## 2. Install the skill

```bash
vastitecture skill install                      # Claude Code, for you: ~/.claude/skills
```

```bash
vastitecture skill install --project            # Claude Code, for one repository: .claude/skills
```

```bash
vastitecture skill install --target codex       # Codex: $CODEX_HOME/skills (default ~/.codex/skills)
```

```bash
vastitecture skill install --target <folder>    # any other tool's skills folder
```

The skill is also attached to each release as `vastitecture-modeling-skill.zip`. Unzip it into the
tool's skills folder.

To update the skill, run the install command again; add `--force` to replace files you have edited.

**Tools without skill support** (Cursor rules, Gemini CLI, Aider, Copilot): add a line to the
project's agent instructions (`AGENTS.md`, `.cursor/rules`, `GEMINI.md`, and so on):

> To create or change architecture models, follow `.claude/skills/vastitecture-modeling/SKILL.md`
> (install it with `vastitecture skill install --project`).

## 3. Or connect over MCP

Start the server in the folder that holds your workspaces. It can read and write only inside that
folder.

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`.cursor/mcp.json`) and other JSON
configurations:

```json
{
  "mcpServers": {
    "vastitecture": {
      "command": "node",
      "args": ["/path/to/vastitecture.mjs", "mcp", "/path/to/architecture"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add vastitecture -- node /path/to/vastitecture.mjs mcp /path/to/architecture
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.vastitecture]
command = "node"
args = ["/path/to/vastitecture.mjs", "mcp", "/path/to/architecture"]
```

Tools:

| Tool | Does |
| --- | --- |
| `list_types` | Element types, relationship types and viewpoints by notation |
| `show_model` | A workspace or one view, as a model spec |
| `apply_model_spec` | Validate and apply a spec; `dry_run` to check first |
| `check_model` | Validation and architecture rules |
| `create_workspace` | Blank workspace, or an industry sample |
| `export_view` | Text exports: Mermaid, C4-PlantUML, Structurizr DSL, ArchiMate exchange, SVG and others |
| `list_formats` | The export formats |

## 4. Try it

With the skill installed, ask your agent something like:

> Create a Vastitecture workspace in `architecture/` for our checkout service: the web app, the order
> API, its Postgres database, Stripe for payments and the warehouse system it notifies. Add a container
> view, and a capability map with Order Management and Payments.

Or, in a repository: "Read this repo and model its services as C4 containers in `architecture/`."

The agent runs `vastitecture types`, writes a spec, runs `apply --dry-run`, fixes what it is told,
applies it and runs `check`. Open the folder in the Vastitecture app to see the diagrams. Every change
is plain YAML in Git, so you can review it in a pull request like any other change.

## The CLI commands for agents

| Command | What it does |
| --- | --- |
| `vastitecture types [--notation c4] [--format text\|json\|markdown]` | Notation vocabulary |
| `vastitecture show [dir] [--view "<name>"] [--format yaml\|json]` | The model as a spec |
| `vastitecture apply [dir] <spec.yaml \| -> [--dry-run]` | Apply a spec. Exit 1 and nothing written on errors |
| `vastitecture check [dir]` | Validation and rules |
| `vastitecture export [dir] --format <id> [--view "<name>"]` | Export as text or files |
| `vastitecture new <dir> [--sample <id>]` | New workspace |
| `vastitecture mcp [dir]` | MCP server over stdio |
| `vastitecture skill install [--target claude\|codex\|<folder>] [--project] [--force]` | Install the skill |

## For contributors

The skill lives in `skills/vastitecture-modeling`. After changing it, or a notation pack, run
`pnpm skill`. It regenerates `reference/notations.md` from the packs and embeds the skill in the CLI.
Tests and CI check that both are up to date. The spec engine is `packages/cli/src/spec.ts`; the MCP
server is `packages/cli/src/mcp.ts`.
