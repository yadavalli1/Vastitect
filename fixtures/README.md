# Fixtures

Sample files used by importer round-trip tests.

Third-party published samples are **not copied into this repository**. Tests read them from
packages installed as dev dependencies:

| Sample | Source package | Used by |
| --- | --- | --- |
| Structurizr DSL workspace templates (basic and advanced) | `create-structurizr` (npm) | `packages/io/structurizr` |
| ArchiSurance model in Archi (`.archimate`) and Model Exchange File Format (`.xml`) | `mcp-archimate` (npm) | `packages/io/archimate` |
| Example CML context map | README of `context-mapper-mcp` (npm) | `packages/io/cml` |
| OpenAPI petstore specs (Swagger 2.0, OpenAPI 3.0) | `@readme/oas-examples` (npm) | `packages/connectors/discovery` |
| Backstage example catalog (`entities.yaml`, `org.yaml`) | `@backstage/create-app` (npm) | `packages/connectors/discovery` |

Files in the sub-folders here were written for this project to cover syntax the published
samples do not exercise. They are not copies of third-party material.

No published docker-compose, Kubernetes, Helm, Terraform or AsyncAPI sample was reachable from the
build environment, so `discovery/` holds files written for this project in those formats.
