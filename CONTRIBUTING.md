# Contributing

Thanks for helping. Bug reports, plugins, notation packs, importers and documentation are all welcome.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Two rules matter most:
  1. **The folder is the source of truth.** Everything else is derived and can be rebuilt.
  2. **The core knows no notation.** If you are about to write `if (notation === "c4")` in
     `packages/core`, put that code in the notation pack instead. ESLint enforces this.
- Large changes: open an issue first so we can agree on the approach.

## Setting up

```bash
pnpm install
```

```bash
pnpm dev
```

The web build runs everything except native file access, the OS keychain and the Rust search index;
use `pnpm tauri dev` for those.

## Checks

Every pull request runs these; please run them locally first:

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm e2e
```

```bash
cargo test -p vastitecture-shell
```

## Conventions

- **Tests.** Importers and exporters need round-trip tests against real sample files. Read published
  samples from their npm packages at test time rather than copying them in (see
  [fixtures/README.md](fixtures/README.md)). Notation packs need validation tests.
- **User-facing text** goes through `t("…")`. Run `pnpm i18n` to update `messages/en.json`.
- **Accessibility.** Everything works from the keyboard; never carry meaning by colour alone; give
  controls labels.
- **No network** unless the user runs a connector or the assistant. No telemetry.
- **Specification text.** Do not copy text from The Open Group's specifications into the code or docs.
- **Commits.** Small, focused, with a message that says why.

## Plugins

See [docs/PLUGINS.md](docs/PLUGINS.md) and `npx create-vastitecture-plugin`.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
