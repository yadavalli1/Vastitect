import type { MappingRule } from "./model";

/**
 * Default cross-notation mapping, copied into each new workspace so it is user-editable.
 * Pure data: the core never interprets these ids beyond matching strings.
 */
export const DEFAULT_MAPPINGS: MappingRule[] = [
  {
    concept: "business-system",
    label: "A business system",
    members: { archimate: ["archimate:ApplicationComponent"], c4: ["c4:SoftwareSystem"], ddd: ["ddd:BoundedContext", "ddd:ExternalSystem"], togaf: ["togaf:ArchitectureBuildingBlock"] },
  },
  {
    concept: "deployable-unit",
    label: "A deployable unit",
    members: { archimate: ["archimate:ApplicationComponent", "archimate:SystemSoftware"], c4: ["c4:Container", "c4:Component"], ddd: ["ddd:Module"], togaf: ["togaf:SolutionBuildingBlock"] },
  },
  {
    concept: "data-store",
    label: "A data store",
    members: { archimate: ["archimate:DataObject", "archimate:Artifact"], c4: ["c4:Container"], ddd: ["ddd:Aggregate"] },
  },
  {
    concept: "person-or-team",
    label: "A person or team",
    members: { archimate: ["archimate:BusinessActor", "archimate:Role"], c4: ["c4:Person"], ddd: ["ddd:Team"] },
  },
  {
    concept: "api",
    label: "An API",
    // C4 and DDD express an API as a relationship (technology, Open Host Service); as an element it maps only to ArchiMate.
    members: { archimate: ["archimate:ApplicationInterface"] },
  },
  {
    concept: "infrastructure",
    label: "Infrastructure",
    members: { archimate: ["archimate:Node", "archimate:Device"], c4: ["c4:DeploymentNode"] },
  },
];
