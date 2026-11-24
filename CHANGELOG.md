# Changelog

## Unreleased

### Industry samples
- Five new sample workspaces beside the online shop:
  - banking (Northbridge Bank);
  - insurance (Harbour Mutual);
  - healthcare (Riverside Health);
  - manufacturing (Atlas Pumps);
  - telecommunications (Meridian Telecom).
- Each is modelled once and shown in C4, ArchiMate, DDD and TOGAF. Each also has portfolio data, a
  legacy system being replaced, the regulations that shape it, an event storm, decision records,
  architecture rules and saved filters. All names are fictional.
- Choose one under Workspace → New workspace → Template, or create one from the command line with
  `vastitecture new <folder> --sample <id>`. `vastitecture samples` lists them.

## 0.3.0

### Design
- A redesigned app: one title bar (workspace switcher with save status, undo/redo, search, Import and
  Export menus, problems, assistant, theme, help), a contextual diagram toolbar, and a grouped navigation
  rail with a consistent icon set.
- Every page has a header and description; tables, cards, menus, tooltips, toasts and dialogs share one
  design system in light and dark themes, with keyboard focus and contrast checked.
- Faster start-up: the XML parser, AI and format packages load on first use.

### Fixes
- Saving no longer deletes files that failed to load (for example after a Git merge conflict).
- Comments are read back by the desktop app.
- Folder pickers on Discover and Insights work in the macOS app.
- Switching workspace right after an edit no longer saves the old model into the new folder.

### Security
A full security review (cloudflare/security-audit-skill, standard profile) of 0.2.0 found 18 issues, all now fixed.
The theme: content or code from someone else (a shared workspace, an imported file, a plugin) could reach further than intended.
- **Plugins:** approval now covers the exact code and where it came from, so a workspace can no longer reuse an approval
  you gave another plugin. A plugin's network allow-list now also applies to redirects and cannot be bypassed through
  request options, panel images or theme styles. A plugin can no longer replace a built-in connector or exporter.
- **Workspace files:** symbolic links are never followed, so a workspace cannot make saves edit or delete files
  outside it. The search index moved to the app's cache folder. `git` runs with settings that stop a repository's
  own configuration from starting programs.
- **Cloud discovery:** the read-only check for `gcloud` and `az` now looks at the whole command, not its last word.
- **Exports:** text from the model can no longer become markup, script or commands in another tool: static HTML site,
  SVG, draw.io, CSV (formulas), C4-PlantUML, Mermaid and Structurizr DSL. Zip archives refuse unsafe file names.
- **Release workflow:** pull-request builds run only when the label is added and never receive signing secrets.
- Element links open only web and mail addresses; the CLI's GitHub annotations escape workspace text.

## 0.2.0

### Governance
- **Architecture rules** written as data in `vastitecture.yaml` (required fields, forbidden dependencies,
  system boundaries, fan-in/fan-out limits). Violations show live in the Problems panel and on a new
  Architecture rules page with an editor and a starter set.
- **`vastitecture` command-line tool** (`packages/cli`): `check` (text, JSON, GitHub annotations, Markdown),
  `diff` between two versions of a workspace, `export` to any format including SVG and vector PDF, and
  `rules init`. See `docs/CLI.md` for a ready-made GitHub workflow.

### Discovery and integrations
- ServiceNow CMDB (live or exports), with **reviewed write-back** of names, descriptions and dependencies.
- Google Cloud and Azure through your own `gcloud`/`az` sign-in; live Kubernetes through `kubectl get`.
- **Runtime traces** from OpenTelemetry, Jaeger, Zipkin or Datadog, compared with the model.
- GitHub organisation scan (CODEOWNERS as owners), Jira and Azure DevOps work items linked to elements.
- Imports from LeanIX, Ardoq and Sparx Enterprise Architect (XMI).
- Cloud costs from AWS, Azure and Google Cloud billing exports.

### Analysis
- **Insights** page: what changed since a commit or another copy (marked on the diagrams), as-is/to-be
  plateaus from lifecycle dates, dependency hotspots, cycles and single points of failure, classified data
  flow, and costs rolled up through the model.
- Comments on elements, stored in the workspace one file each.

### Assistant
- Chat beside the canvas: questions answered from the model, changes and decision records proposed as a
  reviewable diff.

### Export and accessibility
- PDF export is now vector (selectable text); image PDFs remain available.
- Automated WCAG 2.1 AA checks in light and dark themes; fixed missing roles and a low-contrast colour.

### Known limitations
- Installers are unsigned until signing certificates are added as repository secrets.
- LeanIX, Ardoq, Sparx, Jira, Azure DevOps, Datadog, GitHub and billing formats were built from public
  documentation and hand-written samples, not yet checked against real exports.

## 0.1.0
- First development builds: core model, C4, ArchiMate 4, DDD and TOGAF notations, plugins, discovery
  connectors, inventory, AI assistant, desktop app for macOS, Windows and Linux.
