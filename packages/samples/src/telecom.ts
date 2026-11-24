import type { Workspace } from "@vastitecture/core";
import { SampleBuilder, group } from "./builder";

/**
 * Telecommunications: a mobile and broadband operator, modelled along TM Forum lines (order to
 * activate, trouble to resolve, usage to bill), consolidating two billing stacks after a merger and
 * opening network APIs to partners. All names are fictional.
 */
export function buildTelecom(): Workspace {
  const b = new SampleBuilder("Sample: Meridian Telecom (mobile & broadband operator)");

  const subscriber = b.person("Subscriber", "Buys mobile and broadband plans, pays bills, reports faults.");
  const agent = b.person("Care Agent", "Answers calls and chats, changes plans, raises tickets.");
  const fieldTech = b.person("Field Technician", "Installs fibre and fixes faults on site.");
  const partner = b.person("Partner Developer", "Builds apps on the operator's network APIs.");

  const app = b.system("Self-care App", "Plans, usage, bills, top-ups and fault reporting.", { owner: "Digital", tags: ["customer-facing"], phase: "active", criticality: "Business critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 600000, monthlyCost: 50000, data: "confidential" });
  const catalog = b.system("Product Catalog", "Products, offers, prices and eligibility rules (TMF620).", { owner: "Product", phase: "active", criticality: "Business critical", technicalFit: "Excellent", functionalFit: "Excellent", annualCost: 300000, monthlyCost: 25000, data: "internal" });
  const crm = b.system("CRM", "Customers, interactions and cases (TMF629, TMF621).", { owner: "Customer Operations", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 1100000, monthlyCost: 92000, data: "confidential" });
  const om = b.system("Order Management", "Captures and orchestrates product orders into service and resource orders (TMF622, TMF641).", {
    owner: "BSS", tags: ["tier-1"], phase: "active", dates: { active: "2020-03-01" },
    criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 950000, monthlyCost: 79000, data: "confidential",
    props: { domainClassification: "Core", businessModel: "Revenue", evolution: "Custom built", purpose: "Turn an order into a working service, first time.", ubiquitousLanguage: "Product order: what the customer bought.\nService order: what the network must provide.\nFallout: an order that needs a person to finish." },
  });
  const billingA = b.system("Billing (Meridian)", "Rating, charging and invoicing for Meridian customers.", {
    owner: "BSS", tags: ["legacy", "system-of-record"], phase: "phaseOut", dates: { active: "2011-01-01", phaseOut: "2026-03-01", endOfLife: "2027-06-30" },
    criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 2600000, monthlyCost: 217000, data: "restricted", admPhase: "F: Migration Planning",
  });
  const billingB = b.system("Billing (acquired)", "Billing stack from the acquired broadband company.", {
    owner: "BSS", tags: ["legacy", "system-of-record"], phase: "phaseOut", dates: { active: "2014-05-01", phaseOut: "2026-03-01", endOfLife: "2026-12-31" },
    criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Insufficient", annualCost: 1200000, monthlyCost: 100000, data: "restricted", admPhase: "F: Migration Planning",
  });
  const ocs = b.system("Convergent Charging", "Real-time charging and billing for all customers after the merger.", {
    owner: "BSS", tags: ["system-of-record"], phase: "phaseIn", dates: { plan: "2024-11-01", phaseIn: "2025-12-01", active: "2026-09-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 2100000, monthlyCost: 175000, data: "restricted", admPhase: "E: Opportunities and Solutions",
  });
  const mediation = b.system("Mediation", "Collects call, data and usage records from the network and normalises them.", { owner: "BSS", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 400000, monthlyCost: 33000, data: "restricted" });
  const inventory = b.system("Network Inventory", "Physical and logical network resources: fibre, ports, cells, IPs (TMF639).", { owner: "OSS", phase: "active", criticality: "Business critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 500000, monthlyCost: 42000, data: "internal" });
  const activation = b.system("Service Activation", "Configures the network for a new or changed service.", { owner: "OSS", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 450000, monthlyCost: 37500, data: "internal" });
  const assurance = b.system("Service Assurance", "Alarms, correlation and trouble tickets (TMF642, TMF621).", { owner: "OSS", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 700000, monthlyCost: 58000, data: "internal" });
  const workforce = b.system("Field Workforce", "Appointments and jobs for field technicians.", { owner: "Field Operations", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 350000, monthlyCost: 29000, data: "confidential" });
  const core = b.system("5G Core & RAN", "The mobile network: radio, packet core and subscriber data.", { owner: "Network", tags: ["network"], phase: "active", criticality: "Mission critical", technicalFit: "Excellent", annualCost: 18000000, monthlyCost: 1500000, data: "restricted" });
  const exposure = b.system("Network API Gateway", "Exposes network capabilities to partners (CAMARA: location, quality on demand, SIM swap).", {
    owner: "Wholesale", phase: "plan", dates: { plan: "2026-01-01", phaseIn: "2026-07-01", active: "2027-01-01" }, criticality: "Business operational", technicalFit: "Excellent", annualCost: 250000, monthlyCost: 21000, data: "confidential",
  });
  const payments = b.system("Payment Gateway", "Card and direct debit payments.", { external: true, phase: "active", criticality: "Business critical", data: "restricted" });

  const omUi = b.container(om, "Order Capture", "Shopping cart and checkout for app, shops and agents.", "React");
  const orch = b.container(om, "Order Orchestrator", "Decomposes product orders and tracks fulfilment.", "Camunda");
  const fallout = b.container(om, "Fallout Workbench", "Where people finish orders that failed automatically.", "Angular");
  const omDb = b.container(om, "Orders DB", "Product, service and resource orders.", "PostgreSQL", { kind: "Database", data: "confidential" });
  const omEvents = b.container(om, "Order Events", "Order state changes for CRM, billing and the app.", "Kafka", { kind: "Queue" });

  b.rel("c4:Uses", subscriber, app, "Manages plans and bills in", "HTTPS");
  b.rel("c4:Uses", agent, crm, "Serves customers in");
  b.rel("c4:Uses", app, omUi, "Places orders in", "TMF622");
  b.rel("c4:Uses", crm, omUi, "Places orders for customers in", "TMF622");
  b.rel("c4:Uses", omUi, catalog, "Reads offers and prices from", "TMF620");
  b.rel("c4:Uses", omUi, orch, "Submits product orders to");
  b.rel("c4:Uses", orch, omDb, "Stores orders in", "SQL");
  b.rel("c4:Uses", orch, inventory, "Reserves ports and numbers in", "TMF639");
  b.rel("c4:Uses", orch, activation, "Sends service orders to", "TMF641");
  b.rel("c4:Uses", orch, workforce, "Books installation appointments in", "TMF646");
  b.rel("c4:Uses", orch, ocs, "Creates billing accounts in", "TMF666");
  b.rel("c4:Uses", orch, omEvents, "Publishes order state to", "Kafka");
  b.rel("c4:Uses", orch, fallout, "Sends failed orders to");
  b.rel("c4:Uses", activation, core, "Provisions subscribers in", "NETCONF");
  b.rel("c4:Uses", core, mediation, "Sends usage records to", "CDR files");
  b.rel("c4:Uses", mediation, billingA, "Sends rated usage to", "Batch");
  b.rel("c4:Uses", mediation, billingB, "Sends rated usage to", "Batch");
  b.rel("c4:Uses", mediation, ocs, "Sends usage to", "Diameter / Kafka");
  b.rel("c4:Uses", core, ocs, "Asks for credit in real time", "5G CHF (Nchf)");
  b.rel("c4:Uses", app, ocs, "Shows bills and balances from", "TMF678");
  b.rel("c4:Uses", ocs, payments, "Takes payments through", "REST");
  b.rel("c4:Uses", core, assurance, "Raises alarms in", "SNMP / VES");
  b.rel("c4:Uses", assurance, workforce, "Dispatches technicians through", "TMF646");
  b.rel("c4:Uses", fieldTech, workforce, "Receives jobs in", "Mobile app");
  b.rel("c4:Uses", app, assurance, "Reports faults to", "TMF621");
  b.rel("c4:Uses", partner, exposure, "Calls network APIs on", "CAMARA");
  b.rel("c4:Uses", exposure, core, "Queries location and quality from", "NEF");

  // ArchiMate
  const market = b.capability("Market & Sales", "Sell plans.", undefined, "Adequate");
  const catalogCap = b.capability("Product Catalog Management", "Launch offers fast.", market, "Excellent", 300000);
  const orderCap = b.capability("Order Handling", "Capture and fulfil orders.", market, "Adequate", 950000);
  const customerCap = b.capability("Customer Management", "Serve customers across channels.", undefined, "Adequate", 1100000);
  const revenue = b.capability("Revenue Management", "Charge and bill correctly.", undefined, "Insufficient");
  const charging = b.capability("Charging", "Rate usage in real time.", revenue, "Insufficient", 2100000);
  const billingCap = b.capability("Billing & Collections", "Invoice and collect.", revenue, "Insufficient", 3800000);
  const service = b.capability("Service Management", "Deliver and assure services.", undefined, "Adequate");
  const activationCap = b.capability("Service Activation", "Configure the network automatically.", service, "Adequate", 450000);
  const assuranceCap = b.capability("Service Assurance", "Find and fix faults first.", service, "Adequate", 700000);
  const resource = b.capability("Resource Management", "Know and use the network.", undefined, "Insufficient");
  const inventoryCap = b.capability("Resource Inventory", "Keep an accurate network inventory.", resource, "Insufficient", 500000);
  const field = b.capability("Field Operations", "Install and repair on site.", resource, "Adequate", 350000);
  const partners = b.capability("Partner & API Management", "Earn revenue from network APIs.", undefined, "Unreasonable", 250000);
  for (const [s, c] of [[catalog, catalogCap], [om, orderCap], [crm, customerCap], [ocs, charging], [billingA, billingCap], [billingB, billingCap], [ocs, billingCap], [activation, activationCap], [assurance, assuranceCap], [inventory, inventoryCap], [workforce, field], [exposure, partners]] as const) b.rel("archimate:Realization", s, c);

  const vs = b.el("archimate:ValueStream", "Order to activate", "From the customer's order to a working service.");
  const v1 = b.el("archimate:ValueStream", "Choose plan", "Browse offers and check eligibility.");
  const v2 = b.el("archimate:ValueStream", "Place order", "Checkout and credit check.");
  const v3 = b.el("archimate:ValueStream", "Fulfil", "Reserve resources, install and configure.");
  const v4 = b.el("archimate:ValueStream", "Activate and bill", "Service live; first bill.");
  for (const s of [v1, v2, v3, v4]) b.rel("archimate:Composition", vs, s);
  b.chain("archimate:Flow", v1, v2, v3, v4);
  b.rel("archimate:Serving", catalogCap, v1);
  b.rel("archimate:Serving", orderCap, v2);
  b.rel("archimate:Serving", activationCap, v3);
  b.rel("archimate:Serving", field, v3);
  b.rel("archimate:Serving", charging, v4);

  const merger = b.el("archimate:Driver", "Merger synergies", "Two billing stacks double the cost of every price change.");
  const goalBill = b.el("archimate:Goal", "One bill per household", "Mobile and broadband on a single bill by end of 2026.");
  const lawfulData = b.el("archimate:Driver", "Telecoms privacy and data retention", "Usage and location data are restricted and retained by law.");
  const reqConsent = b.el("archimate:Requirement", "Subscriber consent for network APIs", "Location and SIM-swap APIs only with the subscriber's consent.");
  b.rel("archimate:Influence", merger, goalBill);
  b.rel("archimate:Realization", ocs, goalBill);
  b.rel("archimate:Influence", lawfulData, reqConsent);
  b.rel("archimate:Realization", exposure, reqConsent);

  // DDD
  const domain = b.el("ddd:Domain", "Connectivity Services", "Selling, delivering and billing mobile and broadband.");
  const sdOrder = b.el("ddd:Subdomain", "Ordering (subdomain)", "Order-to-activate speed wins customers.", { parent: domain.id, properties: { subdomainType: "Core" } });
  const sdCharge = b.el("ddd:Subdomain", "Charging (subdomain)", "Flexible offers need flexible charging.", { parent: domain.id, properties: { subdomainType: "Core" } });
  b.el("ddd:Subdomain", "Inventory (subdomain)", "Knowing what the network has.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  b.el("ddd:Subdomain", "Payments (subdomain)", "Taking money; bought, not built.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  const teamBss = b.el("ddd:Team", "BSS", "Owns ordering and charging.");
  const teamOss = b.el("ddd:Team", "OSS", "Owns inventory, activation and assurance.");
  b.rel("ddd:Implements", om, sdOrder);
  b.rel("ddd:Implements", ocs, sdCharge);
  b.rel("ddd:Owns", teamBss, om);
  b.rel("ddd:Owns", teamOss, activation);
  b.rel("ddd:PublishedLanguage", catalog, om, "TM Forum Open APIs");
  b.rel("ddd:CustomerSupplier", om, activation, "service orders");
  b.rel("ddd:CustomerSupplier", om, ocs, "billing accounts");
  b.rel("ddd:AnticorruptionLayer", billingB, ocs, "acquired customers").properties.downstreamRoles = "ACL";
  b.rel("ddd:Conformist", activation, core, "network vendor's model");
  b.rel("ddd:OpenHostService", exposure, app, "CAMARA APIs");

  const st = (type: string, name: string, description: string) => b.el(type, name, description, { parent: om.id });
  const cOrder = st("ddd:Command", "Order fibre broadband", "The customer checks out in the app.");
  const aOrder = st("ddd:Aggregate", "Product Order", "Tracks the order and its decomposition.");
  const eAccepted = st("ddd:DomainEvent", "Order accepted", "Credit and address checks passed.");
  const pFulfil = st("ddd:Policy", "Fulfil accepted orders", "Whenever an order is accepted, reserve a port and book an engineer.");
  const eInstalled = st("ddd:DomainEvent", "Line installed", "The technician installed the line.");
  const cActivate = st("ddd:Command", "Activate service", "Configure the line and router.");
  const eActive = st("ddd:DomainEvent", "Service active", "The customer is online; billing starts.");
  const rTracker = st("ddd:ReadModel", "Order tracker", "Order progress shown in the app.");
  b.chain("ddd:Triggers", cOrder, aOrder, eAccepted, pFulfil, eInstalled, cActivate, eActive);
  b.rel("ddd:Triggers", eActive, rTracker);
  b.rel("ddd:Triggers", eAccepted, rTracker);

  // TOGAF
  const abb = b.el("togaf:ArchitectureBuildingBlock", "Convergent charging", "One rating and billing engine for mobile, broadband and partner services.", { properties: { admPhase: "B: Business Architecture" } });
  const sbb = b.el("togaf:SolutionBuildingBlock", "5G-ready convergent charging system", "Real-time charging with the 5G charging function.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  b.rel("togaf:Realizes", sbb, abb);
  b.rel("togaf:Uses", sbb, ocs);

  // views
  const app_ = { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" };
  b.rows("c4", "c4:landscape", "BSS / OSS landscape", [[subscriber, agent, fieldTech, partner], [app, crm, catalog, om], [ocs, billingA, billingB, mediation, payments], [activation, inventory, assurance, workforce], [core, exposure]], { properties: app_ });
  b.rows("c4", "c4:container", "Order Management – containers", [[subscriber, agent], [app, crm], [group(om, [omUi, orch, fallout], [omDb, omEvents])], [catalog, inventory, activation, workforce, ocs]], { subject: om.id, properties: app_ });
  b.rows("c4", "c4:context", "Convergent Charging – context", [[subscriber], [app, core, mediation], [ocs], [payments, billingA, billingB]], { subject: ocs.id });
  b.rows("archimate", "archimate:capability-map", "Capability map", [[group(market, [catalogCap, orderCap]), customerCap, group(revenue, [charging, billingCap])], [group(service, [activationCap, assuranceCap]), group(resource, [inventoryCap, field]), partners]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  b.rows("archimate", "archimate:value-stream", "Order to activate (value stream)", [[group(vs, [v1, v2, v3, v4])], [catalogCap, orderCap, activationCap, field, charging]], { properties: { architectureDomain: "Business" } });
  b.rows("archimate", "archimate:motivation", "Merger and privacy", [[merger, lawfulData], [goalBill, reqConsent]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:requirements-realization", "How requirements are met", [[goalBill, reqConsent], [ocs, exposure]], { properties: { admPhase: "Requirements Management" } });
  b.rows("ddd", "ddd:context-map", "Context map", [[teamBss, teamOss], [catalog, om, activation, core], [billingB, ocs, exposure, app]], { properties: { architectureDomain: "Business" } });
  b.rows("ddd", "ddd:event-storming", "Order fibre broadband (event storm)", [[cOrder, aOrder, eAccepted, pFulfil], [eInstalled, cActivate, eActive, rTracker]]);
  b.canvas("Order Management – Bounded Context Canvas", om);
  b.rows("togaf", "togaf:building-blocks", "Charging building blocks", [[abb], [sbb], [ocs]], { properties: { admPhase: "E: Opportunities and Solutions" } });

  b.adr("0001", "Consolidate both billing stacks onto convergent charging", "accepted", "2024-11-01", [billingA, billingB, ocs], "## Context\n\nAfter the merger, every price change is built twice and households get two bills.\n\n## Decision\n\nMigrate acquired broadband customers first (smaller base), then Meridian mobile, onto one convergent charging system.\n\n## Consequences\n\nMediation feeds all three systems during migration. One household bill from late 2026.");
  b.adr("0002", "Integrate BSS and OSS through TM Forum Open APIs", "accepted", "2023-05-10", [om, catalog, activation, inventory], "## Context\n\nPoint-to-point interfaces made every new product a multi-team project.\n\n## Decision\n\nNew integrations between BSS and OSS use TM Forum Open APIs (TMF620, 622, 639, 641).\n\n## Consequences\n\nVendors can be swapped behind a standard API; some vendor features need extensions.");
  b.ws.rules = [
    { id: "systems-have-owners", description: "Every system has an owner and a lifecycle.", severity: "warning", match: { type: "c4:SoftwareSystem", tag: "system-of-record" }, require: ["owner", "lifecycle"] },
    { id: "billing-fan-in", description: "Keep the number of systems feeding billing under control.", severity: "info", match: { tag: "system-of-record", owner: "BSS" }, maxDependents: 6 },
  ];
  b.ws.savedFilters = [{ name: "Phasing out", query: "phase:phaseout", types: [] }, { name: "BSS", query: "owner:BSS", types: [] }];
  return b.ws;
}
