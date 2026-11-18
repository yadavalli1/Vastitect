# __NAME__

A [Vastitecture](https://github.com/yadavalli1/Vastitect) plugin (`__ID__`).

## Install

Copy this folder to `~/.vastitecture/plugins/__SLUG__` (all workspaces) or to
`<workspace>/.vastitecture/plugins/__SLUG__` (one workspace, shared through Git), then open
**Plugins** in the app and press **Rescan plugin folders**. Turn on **developer mode** there to
reload the plugin automatically whenever you save a file.

The first time it loads, the app shows what the plugin declares in `plugin.json` (capabilities,
network hosts, secrets) and asks you to allow it. Asking for more later requires approval again.

## How it runs

The plugin runs in a sandboxed Web Worker. It has no DOM, no `fetch` and no file access of its
own: everything goes through the `ctx` object passed to `activate`, and the app checks each call
against `plugin.json`. Functions you register (an importer's `import`, a validator's `run`…) are
called across the sandbox boundary and may be `async`.

See `docs/PLUGINS.md` in the Vastitecture repository for the full API.
