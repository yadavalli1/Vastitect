# Command line and CI

`@vastitecture/cli` checks, diffs and exports workspaces without the app. It uses the same model,
validation, notations and exporters as the desktop app, and never reaches the network.

```bash
pnpm --filter @vastitecture/cli build          # writes packages/cli/dist/vastitecture.mjs
node packages/cli/dist/vastitecture.mjs help
```

| Command | What it does |
| --- | --- |
| `check [dir]` | Validates the model and runs the architecture rules. Exit code 1 on problems at or above `--fail-on` (default `error`). `--format text\|json\|github\|markdown`, `--rules-only`. |
| `diff <base> <head>` | Summarises what changed between two copies of a workspace and which problems the change introduces or fixes. Markdown by default, ready for a pull-request comment. |
| `export [dir] --format <id>` | Writes any exporter's output (`formats` lists them). View exporters need `--view "<name>"`. Binary or multi-file formats need `--out`. |
| `formats` | Lists exporters. |
| `rules init [dir]` | Adds a starter rule set to `vastitecture.yaml`. |
| `new <dir> [--sample <id>]` | Creates a workspace in an empty folder: blank, or an industry sample. |
| `samples` | Lists the industry samples (`retail`, `banking`, `insurance`, `healthcare`, `manufacturing`, `telecom`). |

## Architecture rules

Rules live in `vastitecture.yaml` so they are reviewed like any other change. The app shows violations
in the Problems panel as you edit; the CLI enforces them in CI. Rules are data, not code.

```yaml
rules:
  - id: systems-have-owners
    description: Every software system has an owner
    severity: error                 # error | warning | info (default warning)
    match: { type: [c4:SoftwareSystem, archimate:ApplicationComponent] }
    require: [owner]                # owner, description, lifecycle, parent, inView, connected, adr,
                                    # property:<key>, tag:<tag>, link:<repo|runbook|adr|doc|other>
  - id: no-shared-databases
    description: Databases are only used from inside their own system
    forbid:                         # any relationship matching all of these is a violation
      to: { property: { kind: Database } }
      acrossBoundaries: true        # source and target sit under different top-level elements
  - id: no-dependencies-on-retiring
    severity: error
    forbid: { from: { lifecycle: [plan, phaseIn, active] }, to: { lifecycle: [phaseOut, endOfLife] } }
  - id: limit-fan-out
    match: { type: c4:Container }
    maxDependencies: 7              # also maxDependents
```

A selector (`match`, `from`, `to`) can use `type` (one or a list; `c4:*` for a whole notation), `tag`,
`lifecycle`, `property`, `owner` and `name` (a case-insensitive regular expression). `enabled: false`
switches a rule off. A malformed rule is reported as a problem and the others still run.

## GitHub Actions

Save as `.github/workflows/architecture.yml` in the repository that holds your workspace (here in the
folder `architecture/`):

```yaml
name: Architecture
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { path: head }
      - uses: actions/checkout@v4
        with: { ref: "${{ github.base_ref }}", path: base }
      - uses: actions/checkout@v4
        with: { repository: yadavalli1/Vastitect, path: vastitecture }
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - run: cd vastitecture && pnpm install --frozen-lockfile && pnpm --filter @vastitecture/cli build
      - name: Rules and validation (annotations on the pull request)
        run: node vastitecture/packages/cli/dist/vastitecture.mjs check head/architecture --format github --fail-on error
      - name: Change summary
        if: always()
        run: |
          node vastitecture/packages/cli/dist/vastitecture.mjs diff base/architecture head/architecture > summary.md || true
          cat summary.md >> "$GITHUB_STEP_SUMMARY"
          gh pr comment ${{ github.event.number }} --edit-last --body-file summary.md || gh pr comment ${{ github.event.number }} --body-file summary.md
        env: { GH_TOKEN: "${{ github.token }}", GH_REPO: "${{ github.repository }}" }
```
