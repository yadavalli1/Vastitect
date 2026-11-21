# Changelog

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
