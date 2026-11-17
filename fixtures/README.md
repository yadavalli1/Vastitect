# Fixtures

Sample files used by importer round-trip tests.

Third-party published samples are **not copied into this repository**. Tests read them from
packages installed as dev dependencies:

| Sample | Source package | Used by |
| --- | --- | --- |
| Structurizr DSL workspace templates (basic and advanced) | `create-structurizr` (npm) | `packages/io/structurizr` |
| ArchiSurance model in Archi (`.archimate`) and Model Exchange File Format (`.xml`) | `mcp-archimate` (npm) | `packages/io/archi`, `packages/io/archimate-exchange` |

Files in the sub-folders here were written for this project to cover syntax the published
samples do not exercise. They are not copies of third-party material.
