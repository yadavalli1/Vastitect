import type { Workspace } from "@vastitecture/core";
import { SampleBuilder, group } from "./builder";

/**
 * Manufacturing: a discrete manufacturer of industrial pumps with ERP, MES, PLM and shop-floor
 * equipment (ISA-95 levels 0 to 4), a move to cloud ERP and an industrial IoT platform for predictive
 * maintenance. Includes a deployment-style technology view. All names are fictional.
 */
export function buildManufacturing(): Workspace {
  const b = new SampleBuilder("Sample: Atlas Pumps (discrete manufacturing)");

  const planner = b.person("Production Planner", "Plans orders onto lines and shifts.");
  const operator = b.person("Line Operator", "Runs machines and records production.");
  const engineer = b.person("Design Engineer", "Designs products and releases bills of materials.");
  const maint = b.person("Maintenance Engineer", "Keeps machines running.");
  const customer = b.person("Distributor", "Orders pumps and tracks deliveries.");

  const erp = b.system("ERP (on-premise)", "Sales orders, MRP, purchasing, inventory and finance.", {
    owner: "Enterprise Applications", tags: ["legacy", "system-of-record"], phase: "phaseOut", dates: { active: "2008-01-01", phaseOut: "2026-06-01", endOfLife: "2027-12-31" },
    criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 1900000, monthlyCost: 158000, data: "confidential", admPhase: "F: Migration Planning",
  });
  const cloudErp = b.system("Cloud ERP", "Replacement ERP, rolled out plant by plant.", {
    owner: "Enterprise Applications", tags: ["system-of-record"], phase: "phaseIn", dates: { plan: "2025-01-01", phaseIn: "2026-01-15", active: "2027-01-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 1400000, monthlyCost: 117000, data: "confidential", admPhase: "E: Opportunities and Solutions",
  });
  const mes = b.system("MES", "Manufacturing execution: work orders, routing, quality checks and traceability on the shop floor.", {
    owner: "Plant IT", tags: ["tier-1", "ot"], phase: "active", dates: { active: "2016-09-01" },
    criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 820000, monthlyCost: 68000, data: "internal",
    props: { domainClassification: "Core", businessModel: "Cost reduction", evolution: "Product", purpose: "Build every pump right first time, and prove it.", ubiquitousLanguage: "Work order: one batch to build.\nRouting: the operations a work order goes through.\nGenealogy: which parts and lots went into a serial number." },
  });
  const plm = b.system("PLM", "Product designs, CAD, engineering change and released bills of materials.", { owner: "Engineering", phase: "active", criticality: "Business critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 600000, monthlyCost: 50000, data: "restricted" });
  const qms = b.system("Quality Management", "Non-conformances, corrective actions and supplier quality.", { owner: "Quality", phase: "active", criticality: "Business critical", technicalFit: "Insufficient", annualCost: 180000, monthlyCost: 15000, data: "internal" });
  const scada = b.system("SCADA / Historian", "Supervises the lines and stores sensor data.", { owner: "Plant IT", tags: ["ot"], phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 260000, monthlyCost: 22000, data: "internal" });
  const iot = b.system("Industrial IoT Platform", "Cloud platform for machine data, dashboards and predictive maintenance models.", {
    owner: "Digital Manufacturing", phase: "phaseIn", dates: { plan: "2025-03-01", phaseIn: "2025-09-01", active: "2026-06-01" },
    criticality: "Business operational", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 350000, monthlyCost: 29000, data: "internal",
  });
  const cmms = b.system("Maintenance (CMMS)", "Maintenance work orders, spares and schedules.", { owner: "Maintenance", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 120000, monthlyCost: 10000, data: "internal" });
  const wms = b.system("Warehouse Management", "Raw material and finished goods stock, picking and shipping.", { owner: "Logistics", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 240000, monthlyCost: 20000, data: "internal" });
  const portal = b.system("Distributor Portal", "Orders, availability, delivery tracking and certificates of conformity.", { owner: "Sales", tags: ["customer-facing"], phase: "active", criticality: "Business operational", technicalFit: "Excellent", annualCost: 150000, monthlyCost: 12500, data: "confidential" });
  const suppliers = b.system("Supplier Network", "Purchase orders, advance shipping notices and invoices over EDI.", { external: true, phase: "active", data: "confidential" });
  const carriers = b.system("Carriers", "Freight booking and tracking.", { external: true, phase: "active", data: "internal" });

  const mesUi = b.container(mes, "Operator Terminals", "Start, stop and record work at each station.", "Web, touch screens");
  const mesCore = b.container(mes, "Production Execution", "Dispatches work orders and enforces routings.", "Vendor MES");
  const mesQuality = b.container(mes, "In-line Quality", "Measurements, limits and holds.", "Vendor MES");
  const mesDb = b.container(mes, "Genealogy DB", "Serial numbers, lots and test results.", "SQL Server", { kind: "Database" });
  const opc = b.container(mes, "OPC UA Gateway", "Reads machine states and counts from PLCs.", "OPC UA");

  b.rel("c4:Uses", customer, portal, "Orders and tracks pumps in", "HTTPS");
  b.rel("c4:Uses", portal, erp, "Creates sales orders in", "SOAP");
  b.rel("c4:Uses", portal, cloudErp, "Creates sales orders in", "OData");
  b.rel("c4:Uses", engineer, plm, "Designs and releases in");
  b.rel("c4:Uses", plm, erp, "Releases bills of materials to", "Batch");
  b.rel("c4:Uses", plm, cloudErp, "Releases bills of materials to", "REST");
  b.rel("c4:Uses", plm, mes, "Sends routings and work instructions to", "REST");
  b.rel("c4:Uses", planner, erp, "Runs MRP and releases orders in");
  b.rel("c4:Uses", erp, mesCore, "Sends production orders to", "ISA-95 B2MML");
  b.rel("c4:Uses", cloudErp, mesCore, "Sends production orders to", "ISA-95 B2MML");
  b.rel("c4:Uses", mesCore, erp, "Confirms production and consumption to", "ISA-95 B2MML");
  b.rel("c4:Uses", operator, mesUi, "Records work in", "HTTPS");
  b.rel("c4:Uses", mesUi, mesCore, "Starts and completes operations in");
  b.rel("c4:Uses", mesCore, mesQuality, "Holds failed parts in");
  b.rel("c4:Uses", mesCore, mesDb, "Writes genealogy to", "SQL");
  b.rel("c4:Uses", opc, scada, "Reads machine data from", "OPC UA");
  b.rel("c4:Uses", mesCore, opc, "Gets machine counts from", "OPC UA");
  b.rel("c4:Uses", scada, iot, "Streams sensor data to", "MQTT", { dataFlow: "none" });
  b.rel("c4:Uses", iot, cmms, "Raises predicted maintenance in", "REST");
  b.rel("c4:Uses", maint, cmms, "Plans and records maintenance in");
  b.rel("c4:Uses", mesQuality, qms, "Opens non-conformances in", "REST");
  b.rel("c4:Uses", erp, suppliers, "Sends purchase orders to", "EDI 850");
  b.rel("c4:Uses", erp, wms, "Sends deliveries to", "IDoc");
  b.rel("c4:Uses", wms, carriers, "Books freight with", "REST");

  // Technology (ISA-95 levels, deployment)
  const plant = b.item("c4:DeploymentNode", "Plant Ostrava", "The pump assembly plant.", { props: { environment: "Production" } });
  const l2 = b.item("c4:DeploymentNode", "Level 2–3 network (DMZ)", "Plant servers between the control network and the office.", { props: { environment: "Production" } }, plant);
  const l1 = b.item("c4:DeploymentNode", "Level 0–1 control network", "PLCs, drives and sensors on the lines.", { props: { environment: "Production" } }, plant);
  const plc = b.item("c4:InfrastructureNode", "Assembly line PLCs", "Siemens S7 controllers.", { technology: "PLC" }, l1);
  const mesSrv = b.item("c4:InfrastructureNode", "MES servers", "Virtualised cluster.", { technology: "VMware" }, l2);
  const firewall = b.item("c4:InfrastructureNode", "Industrial firewall", "Zones and conduits between levels (IEC 62443).", { technology: "Firewall" }, plant);
  b.rel("c4:Uses", mesSrv, firewall, "Reaches PLCs through", "OPC UA");
  b.rel("c4:Uses", firewall, plc, "Allows read-only OPC UA to", "OPC UA");

  // ArchiMate
  const design = b.capability("Product Development", "Design pumps customers want.", undefined, "Excellent");
  const engineering = b.capability("Engineering Change", "Change designs safely.", design, "Adequate", 600000);
  const plan = b.capability("Planning", "Turn demand into a feasible plan.", undefined, "Insufficient");
  const mrp = b.capability("Material Planning", "Have parts in time.", plan, "Insufficient", 900000);
  const scheduling = b.capability("Production Scheduling", "Sequence orders on lines.", plan, "Insufficient", 200000);
  const make = b.capability("Manufacturing", "Build pumps.", undefined, "Excellent");
  const execution = b.capability("Production Execution", "Run work orders on the floor.", make, "Excellent", 820000);
  const quality = b.capability("Quality Assurance", "Build right first time.", make, "Adequate", 180000);
  const traceability = b.capability("Traceability", "Know what went into every pump.", make, "Excellent");
  const assets = b.capability("Asset Management", "Keep machines available.", undefined, "Adequate");
  const maintenanceCap = b.capability("Predictive Maintenance", "Fix machines before they fail.", assets, "Insufficient", 350000);
  const supply = b.capability("Supply Chain", "Buy, store and ship.", undefined, "Adequate");
  const procurement = b.capability("Procurement", "Buy parts.", supply, "Adequate", 500000);
  const logistics = b.capability("Logistics", "Store and ship.", supply, "Adequate", 240000);
  for (const [s, c] of [[plm, engineering], [erp, mrp], [cloudErp, mrp], [erp, scheduling], [mes, execution], [mesQuality, quality], [qms, quality], [mesDb, traceability], [iot, maintenanceCap], [cmms, maintenanceCap], [erp, procurement], [wms, logistics]] as const) b.rel("archimate:Realization", s, c);

  const oee = b.el("archimate:Goal", "Raise OEE from 64% to 75%", "Overall equipment effectiveness across all lines.");
  const iec = b.el("archimate:Driver", "IEC 62443", "Security for industrial automation and control systems.");
  const reqZones = b.el("archimate:Requirement", "Zones and conduits", "No direct connection from the office or cloud to the control network.");
  const reqTrace = b.el("archimate:Requirement", "Serial-level traceability", "Every pump's parts, lots and test results for 15 years.");
  const pressure = b.el("archimate:Driver", "Customer quality requirements", "Certificates of conformity for every pump.");
  b.rel("archimate:Influence", iec, reqZones);
  b.rel("archimate:Influence", pressure, reqTrace);
  b.rel("archimate:Realization", firewall, reqZones);
  b.rel("archimate:Realization", mes, reqTrace);
  b.rel("archimate:Realization", iot, oee);
  b.rel("archimate:Realization", mes, oee);

  // DDD
  const domain = b.el("ddd:Domain", "Pump Manufacturing", "Designing, building and delivering industrial pumps.");
  const sdProd = b.el("ddd:Subdomain", "Production (subdomain)", "Quality and cost on the line: where the company competes.", { parent: domain.id, properties: { subdomainType: "Core" } });
  const sdEng = b.el("ddd:Subdomain", "Engineering (subdomain)", "Product designs and change control.", { parent: domain.id, properties: { subdomainType: "Core" } });
  b.el("ddd:Subdomain", "Procurement (subdomain)", "Buying parts.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  b.el("ddd:Subdomain", "Finance (subdomain)", "Accounting; standard package.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  const teamPlant = b.el("ddd:Team", "Plant IT", "Runs MES and SCADA.");
  const teamEa = b.el("ddd:Team", "Enterprise Applications", "Runs ERP.");
  b.rel("ddd:Implements", mes, sdProd);
  b.rel("ddd:Implements", plm, sdEng);
  b.rel("ddd:Owns", teamPlant, mes);
  b.rel("ddd:Owns", teamEa, cloudErp);
  b.rel("ddd:PublishedLanguage", erp, mes, "ISA-95 B2MML");
  b.rel("ddd:CustomerSupplier", plm, mes, "released routings");
  b.rel("ddd:CustomerSupplier", plm, erp, "released BOMs");
  b.rel("ddd:Conformist", scada, mes, "OPC UA information model");
  b.rel("ddd:SeparateWays", qms, cmms);

  const st = (type: string, name: string, description: string) => b.el(type, name, description, { parent: mes.id });
  const cRelease = st("ddd:Command", "Release work order", "Planning releases an order to the line.");
  const aWo = st("ddd:Aggregate", "Work Order", "Tracks operations, quantities and holds.");
  const eStarted = st("ddd:DomainEvent", "Operation started", "An operator started the first operation.");
  const eFailed = st("ddd:DomainEvent", "Test failed", "A pump failed its pressure test.");
  const pHold = st("ddd:Policy", "Hold failed units", "Whenever a test fails, put the unit on hold and open a non-conformance.");
  const cRework = st("ddd:Command", "Rework unit", "Repair and retest.");
  const eDone = st("ddd:DomainEvent", "Work order completed", "Good units are booked to stock.");
  const rGen = st("ddd:ReadModel", "Pump genealogy", "Parts, lots and tests for a serial number.");
  b.chain("ddd:Triggers", cRelease, aWo, eStarted, eFailed, pHold, cRework, eDone, rGen);

  // TOGAF
  const abb = b.el("togaf:ArchitectureBuildingBlock", "Machine data platform", "Collect, store and analyse machine data across plants.", { properties: { admPhase: "B: Business Architecture" } });
  const sbb = b.el("togaf:SolutionBuildingBlock", "Industrial IoT Platform", "Cloud IoT with an edge gateway in each plant's DMZ.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  b.rel("togaf:Realizes", sbb, abb);
  b.rel("togaf:Uses", sbb, iot);

  // views
  const app_ = { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" };
  b.rows("c4", "c4:landscape", "Enterprise landscape", [[customer, engineer, planner, operator, maint], [portal, plm, erp, cloudErp], [mes, qms, wms, cmms], [scada, iot, suppliers, carriers]], { properties: app_ });
  b.rows("c4", "c4:container", "MES – containers", [[operator, planner], [erp, group(mes, [mesUi, mesCore, mesQuality], [opc, mesDb])], [scada, qms, plm]], { subject: mes.id, properties: app_ });
  b.rows("c4", "c4:deployment", "Plant network (ISA-95 levels)", [[group(plant, [group(l2, [mesSrv]), firewall], [group(l1, [plc])])]], { properties: { admPhase: "D: Technology Architecture", architectureDomain: "Technology" } });
  b.rows("archimate", "archimate:capability-map", "Capability map", [[group(design, [engineering]), group(plan, [mrp, scheduling]), group(make, [execution, quality, traceability])], [group(assets, [maintenanceCap]), group(supply, [procurement, logistics])]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  b.rows("archimate", "archimate:motivation", "Goals and requirements", [[iec, pressure], [reqZones, reqTrace, oee]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:requirements-realization", "How requirements are met", [[reqTrace, oee], [mes, iot]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:application", "Application cooperation", [[plm, erp, cloudErp], [mes, qms, wms], [scada, iot, cmms]], { properties: { ...app_, alsoShow: "c4" } });
  b.rows("ddd", "ddd:context-map", "Context map", [[teamEa, teamPlant], [plm, erp, cloudErp], [mes, scada, qms, cmms]], { properties: { architectureDomain: "Business" } });
  b.rows("ddd", "ddd:event-storming", "Work order with a failed test (event storm)", [[cRelease, aWo, eStarted, eFailed], [pHold, cRework, eDone, rGen]]);
  b.canvas("MES – Bounded Context Canvas", mes);
  b.rows("togaf", "togaf:building-blocks", "Machine data building blocks", [[abb], [sbb], [iot]], { properties: { admPhase: "E: Opportunities and Solutions" } });

  b.adr("0001", "No direct connection from the cloud to the control network", "accepted", "2025-03-15", [iot, scada, firewall], "## Context\n\nThe IoT platform needs machine data; the control network must stay isolated (IEC 62443).\n\n## Decision\n\nAn edge gateway in the DMZ reads from the historian and publishes outbound over MQTT. Nothing connects inbound to levels 0–1.\n\n## Consequences\n\nData is a few seconds behind real time. Commands to machines are never sent from the cloud.");
  b.adr("0002", "Move to cloud ERP one plant at a time", "accepted", "2025-01-01", [erp, cloudErp, mes], "## Context\n\nThe on-premise ERP leaves support at the end of 2027.\n\n## Decision\n\nPlants move one at a time; MES keeps the same ISA-95 interface, so the shop floor does not change.\n\n## Consequences\n\nBoth ERPs run during the rollout; consolidation reporting reads from both.");
  b.ws.rules = [
    { id: "ot-is-isolated", description: "Nothing outside the plant connects straight to the control network.", severity: "error", forbid: { from: { type: "c4:SoftwareSystem", tag: "external" }, to: { tag: "ot" } } },
    { id: "systems-have-owners", description: "Every system has an owner.", severity: "warning", match: { type: "c4:SoftwareSystem", tag: ["system-of-record", "ot"] }, require: ["owner"] },
  ];
  b.ws.savedFilters = [{ name: "Shop floor (OT)", query: "tag:ot", types: [] }, { name: "Phasing out", query: "phase:phaseout", types: [] }];
  return b.ws;
}
