# Notation vocabulary

Generated from the app's notation packs by `vastitecture types --format markdown`. Use these ids in model specs.

## ArchiMate 4 (`archimate`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |
| `archimate:Role` | Role | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Collaboration` | Collaboration | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Path` | Path | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Process` | Process | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Function` | Function | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Service` | Service | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Event` | Event | Common; properties: domain (Business \| Application \| Technology \| Implementation) |
| `archimate:Grouping` | Grouping | Common; can contain other elements |
| `archimate:Location` | Location | Common |
| `archimate:Stakeholder` | Stakeholder | Motivation |
| `archimate:Driver` | Driver | Motivation |
| `archimate:Assessment` | Assessment | Motivation |
| `archimate:Goal` | Goal | Motivation |
| `archimate:Outcome` | Outcome | Motivation |
| `archimate:Principle` | Principle | Motivation |
| `archimate:Requirement` | Requirement | Motivation |
| `archimate:Meaning` | Meaning | Motivation |
| `archimate:Value` | Value | Motivation |
| `archimate:Resource` | Resource | Strategy |
| `archimate:Capability` | Capability | Strategy |
| `archimate:ValueStream` | Value Stream | Strategy |
| `archimate:CourseOfAction` | Course Of Action | Strategy |
| `archimate:BusinessActor` | Business Actor | Business |
| `archimate:BusinessInterface` | Business Interface | Business |
| `archimate:BusinessObject` | Business Object | Business |
| `archimate:Product` | Product | Business |
| `archimate:ApplicationComponent` | Application Component | Application |
| `archimate:ApplicationInterface` | Application Interface | Application |
| `archimate:DataObject` | Data Object | Application |
| `archimate:Node` | Node | Technology |
| `archimate:Device` | Device | Technology |
| `archimate:SystemSoftware` | System Software | Technology |
| `archimate:TechnologyInterface` | Technology Interface | Technology |
| `archimate:CommunicationNetwork` | Communication Network | Technology |
| `archimate:Artifact` | Artifact | Technology |
| `archimate:Equipment` | Equipment | Technology |
| `archimate:Facility` | Facility | Technology |
| `archimate:DistributionNetwork` | Distribution Network | Technology |
| `archimate:Material` | Material | Technology |
| `archimate:WorkPackage` | Work Package | Implementation |
| `archimate:Deliverable` | Deliverable | Implementation |
| `archimate:Plateau` | Plateau | Implementation |
| `archimate:Junction` | Junction | Common; properties: junctionType (and \| or) |

### Relationship types

`archimate:Composition` (Composition), `archimate:Aggregation` (Aggregation), `archimate:Assignment` (Assignment), `archimate:Realization` (Realization), `archimate:Serving` (Serving), `archimate:Access` (Access), `archimate:Influence` (Influence), `archimate:Association` (Association), `archimate:Triggering` (Triggering), `archimate:Flow` (Flow), `archimate:Specialization` (Specialization)

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |
| `archimate:organization` | Organization | `archimate:BusinessActor`, `archimate:Role`, `archimate:Collaboration`, `archimate:BusinessInterface`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:business-process-cooperation` | Business Process Cooperation | `archimate:BusinessActor`, `archimate:BusinessInterface`, `archimate:BusinessObject`, `archimate:Product`, `archimate:Role`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:ApplicationComponent`, `archimate:DataObject`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:product` | Product | `archimate:BusinessActor`, `archimate:BusinessInterface`, `archimate:BusinessObject`, `archimate:Product`, `archimate:Role`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Value`, `archimate:Artifact`, `archimate:Material`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:application-cooperation` | Application Cooperation | `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:application-usage` | Application Usage | `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:BusinessActor`, `archimate:Role`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:BusinessObject`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:implementation-deployment` | Implementation and Deployment | `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Node`, `archimate:Device`, `archimate:SystemSoftware`, `archimate:TechnologyInterface`, `archimate:CommunicationNetwork`, `archimate:Artifact`, `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:Path`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:technology` | Technology | `archimate:Node`, `archimate:Device`, `archimate:SystemSoftware`, `archimate:TechnologyInterface`, `archimate:CommunicationNetwork`, `archimate:Artifact`, `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:Path`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:technology-usage` | Technology Usage | `archimate:Node`, `archimate:Device`, `archimate:SystemSoftware`, `archimate:TechnologyInterface`, `archimate:CommunicationNetwork`, `archimate:Artifact`, `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:Path`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:information-structure` | Information Structure | `archimate:BusinessObject`, `archimate:DataObject`, `archimate:Artifact`, `archimate:Material`, `archimate:Meaning`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:service-realization` | Service Realization | `archimate:BusinessActor`, `archimate:BusinessInterface`, `archimate:BusinessObject`, `archimate:Product`, `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Role`, `archimate:Collaboration`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Event`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:physical` | Physical | `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:Node`, `archimate:Device`, `archimate:Path`, `archimate:CommunicationNetwork`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:layered` | Layered | any of this notation |
| `archimate:stakeholder` | Stakeholder | `archimate:Stakeholder`, `archimate:Driver`, `archimate:Assessment`, `archimate:Goal`, `archimate:Outcome`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:goal-realization` | Goal Realization | `archimate:Goal`, `archimate:Outcome`, `archimate:Principle`, `archimate:Requirement`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:requirements-realization` | Requirements Realization | `archimate:Goal`, `archimate:Outcome`, `archimate:Principle`, `archimate:Requirement`, `archimate:BusinessActor`, `archimate:BusinessInterface`, `archimate:BusinessObject`, `archimate:Product`, `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Node`, `archimate:Device`, `archimate:SystemSoftware`, `archimate:TechnologyInterface`, `archimate:CommunicationNetwork`, `archimate:Artifact`, `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:Role`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:motivation` | Motivation | `archimate:Stakeholder`, `archimate:Driver`, `archimate:Assessment`, `archimate:Goal`, `archimate:Outcome`, `archimate:Principle`, `archimate:Requirement`, `archimate:Meaning`, `archimate:Value`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:strategy` | Strategy | `archimate:Resource`, `archimate:Capability`, `archimate:ValueStream`, `archimate:CourseOfAction`, `archimate:Outcome`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:capability-map` | Capability Map | `archimate:Capability`, `archimate:Resource`, `archimate:Outcome`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:outcome-realization` | Outcome Realization | `archimate:Outcome`, `archimate:Capability`, `archimate:Resource`, `archimate:ValueStream`, `archimate:CourseOfAction`, `archimate:Value`, `archimate:Meaning`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:resource-map` | Resource Map | `archimate:Resource`, `archimate:Capability`, `archimate:WorkPackage`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:value-stream` | Value Stream | `archimate:ValueStream`, `archimate:Capability`, `archimate:Outcome`, `archimate:Stakeholder`, `archimate:Value`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:project` | Project | `archimate:WorkPackage`, `archimate:Deliverable`, `archimate:Plateau`, `archimate:Goal`, `archimate:BusinessActor`, `archimate:Role`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:migration` | Migration | `archimate:Plateau`, `archimate:Assessment`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:implementation-migration` | Implementation and Migration | `archimate:WorkPackage`, `archimate:Deliverable`, `archimate:Plateau`, `archimate:Stakeholder`, `archimate:Driver`, `archimate:Assessment`, `archimate:Goal`, `archimate:Outcome`, `archimate:Principle`, `archimate:Requirement`, `archimate:Meaning`, `archimate:Value`, `archimate:BusinessActor`, `archimate:BusinessInterface`, `archimate:BusinessObject`, `archimate:Product`, `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:Node`, `archimate:Device`, `archimate:SystemSoftware`, `archimate:TechnologyInterface`, `archimate:CommunicationNetwork`, `archimate:Artifact`, `archimate:Equipment`, `archimate:Facility`, `archimate:DistributionNetwork`, `archimate:Material`, `archimate:Role`, `archimate:Process`, `archimate:Function`, `archimate:Service`, `archimate:Location`, `archimate:Grouping`, `archimate:Junction` |
| `archimate:application` | Application (cross-notation) | `archimate:ApplicationComponent`, `archimate:ApplicationInterface`, `archimate:DataObject`, `archimate:BusinessActor`, `archimate:Role`, `archimate:Service`, `archimate:Function`, `archimate:Process`, `archimate:SystemSoftware`, `archimate:Node`, `archimate:Artifact`, `archimate:Grouping`, `archimate:Junction` |

## C4 model (`c4`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |
| `c4:Person` | Person | Static; properties: location (Internal \| External) |
| `c4:SoftwareSystem` | Software System | Static; can contain other elements; properties: location (Internal \| External) |
| `c4:Container` | Container | Static; can contain other elements; properties: technology, kind (Application \| Database \| Queue \| Browser \| Mobile \| Folder) |
| `c4:Component` | Component | Static; properties: technology |
| `c4:DeploymentNode` | Deployment Node | Deployment; can contain other elements; properties: technology, environment, instances |
| `c4:InfrastructureNode` | Infrastructure Node | Deployment; properties: technology |

### Relationship types

`c4:Uses` (Uses)

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |
| `c4:landscape` | System Landscape | `c4:Person`, `c4:SoftwareSystem` |
| `c4:context` | System Context | `c4:Person`, `c4:SoftwareSystem` |
| `c4:container` | Container | `c4:Person`, `c4:SoftwareSystem`, `c4:Container` |
| `c4:component` | Component | `c4:Person`, `c4:SoftwareSystem`, `c4:Container`, `c4:Component` |
| `c4:dynamic` | Dynamic | `c4:Person`, `c4:SoftwareSystem`, `c4:Container`, `c4:Component` |
| `c4:deployment` | Deployment | `c4:DeploymentNode`, `c4:InfrastructureNode`, `c4:SoftwareSystem`, `c4:Container` |

## Domain-Driven Design (`ddd`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |
| `ddd:Domain` | Domain | Strategic; can contain other elements |
| `ddd:Subdomain` | Subdomain | Strategic; can contain other elements; properties: subdomainType (Core \| Supporting \| Generic) |
| `ddd:BoundedContext` | Bounded Context | Strategic; properties: contextType (Feature \| Application \| System \| Team), implementationTechnology, bigBallOfMud |
| `ddd:ExternalSystem` | External System | Strategic |
| `ddd:Team` | Team | Strategic |
| `ddd:Module` | Module | Tactical; can contain other elements |
| `ddd:Aggregate` | Aggregate | Tactical |
| `ddd:Entity` | Entity | Tactical |
| `ddd:ValueObject` | Value Object | Tactical |
| `ddd:DomainEvent` | Domain Event | Tactical |
| `ddd:Command` | Command | Tactical |
| `ddd:Policy` | Policy | Tactical |
| `ddd:ReadModel` | Read Model | Tactical |

### Relationship types

`ddd:Partnership` (Partnership), `ddd:SharedKernel` (Shared Kernel), `ddd:CustomerSupplier` (Customer/Supplier), `ddd:UpstreamDownstream` (Upstream/Downstream), `ddd:Conformist` (Conformist), `ddd:AnticorruptionLayer` (Anticorruption Layer), `ddd:OpenHostService` (Open Host Service), `ddd:PublishedLanguage` (Published Language), `ddd:SeparateWays` (Separate Ways), `ddd:BigBallOfMud` (Big Ball of Mud), `ddd:Implements` (Implements), `ddd:Owns` (Owns), `ddd:Triggers` (Triggers), `ddd:References` (References)

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |
| `ddd:context-map` | Context Map | `ddd:BoundedContext`, `ddd:ExternalSystem`, `ddd:Team`, `ddd:Domain`, `ddd:Subdomain` |
| `ddd:canvas` | Bounded Context Canvas (form) |  |
| `ddd:event-storming` | Event Storming | `ddd:DomainEvent`, `ddd:Command`, `ddd:Policy`, `ddd:ReadModel`, `ddd:Aggregate`, `ddd:ExternalSystem`, `ddd:Team` |
| `ddd:tactical` | Tactical model | `ddd:BoundedContext`, `ddd:Module`, `ddd:Aggregate`, `ddd:Entity`, `ddd:ValueObject`, `ddd:DomainEvent`, `ddd:Command`, `ddd:Policy`, `ddd:ReadModel` |

## TOGAF (`togaf`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |
| `togaf:ArchitectureBuildingBlock` | Architecture Building Block | Building blocks |
| `togaf:SolutionBuildingBlock` | Solution Building Block | Building blocks |

### Relationship types

`togaf:Realizes` (Realizes), `togaf:Uses` (Uses)

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |
| `togaf:building-blocks` | Building blocks | any of this notation |

Properties for elements of any notation: admPhase (Preliminary | A: Architecture Vision | B: Business Architecture | C: Information Systems Architectures | D: Technology Architecture | E: Opportunities and Solutions | F: Migration Planning | G: Implementation Governance | H: Architecture Change Management | Requirements Management), buildingBlock (Architecture (ABB) | Solution (SBB))

## Generic (`generic`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |
| `generic:Box` | Box | Shapes |
| `generic:RoundedBox` | Rounded Box | Shapes |
| `generic:Group` | Group | Shapes; can contain other elements |
| `generic:Note` | Note | Shapes |
| `generic:Image` | Image | Shapes; properties: href |
| `generic:StartEnd` | Start / End | Flowchart |
| `generic:Process` | Process | Flowchart |
| `generic:Decision` | Decision | Flowchart |
| `generic:Data` | Data | Flowchart |
| `generic:Document` | Document | Flowchart |
| `generic:Database` | Database | Flowchart |
| `generic:Actor` | Actor | Flowchart |

### Relationship types

`generic:Arrow` (Arrow), `generic:Dashed` (Dashed arrow), `generic:Line` (Line)

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |
| `generic:whiteboard` | Whiteboard | any of this notation |
| `generic:flowchart` | Flowchart | any of this notation |

## Inventory (`inventory`)

### Element types

| Id | Name | Notes |
| --- | --- | --- |

### Relationship types

none

### Viewpoints

| Id | Name | Element types allowed |
| --- | --- | --- |

Properties for elements of any notation: criticality (Mission critical | Business critical | Business operational | Administrative), technicalFit (Excellent | Adequate | Insufficient | Unreasonable), functionalFit (Excellent | Adequate | Insufficient | Unreasonable), annualCost

