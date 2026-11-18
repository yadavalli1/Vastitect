import { DEFAULT_MAPPINGS, emptyWorkspace, makeElement, makeRelationship, makeView, type Element, type View, type ViewNode, type Workspace } from "@vastitecture/core";

/**
 * First-launch workspace: a small online shop modelled once and shown in C4, ArchiMate, DDD and TOGAF.
 * "Online Shop" is one element that appears in a C4 container view, an ArchiMate application view
 * and a DDD context map.
 */
export function buildSample(): Workspace {
  const ws: Workspace = { ...emptyWorkspace("Sample: Online Shop", ["archimate", "c4", "ddd", "togaf", "generic"]), mappings: DEFAULT_MAPPINGS };
  const el = (type: string, name: string, description: string, extra: Partial<Element> = {}) => {
    const e = makeElement(type, name, { description, ...extra });
    ws.elements[e.id] = e;
    return e;
  };
  const rel = (type: string, a: Element, b: Element, label?: string, technology?: string) => {
    const r = makeRelationship(type, a.id, b.id, { ...(label ? { label } : {}), ...(technology ? { technology } : {}) });
    ws.relationships[r.id] = r;
    return r;
  };
  const view = (notation: string, viewpoint: string, name: string, nodes: [Element, number, number, number?, number?, Element?][], extra: Partial<View> = {}) => {
    const v = makeView(notation, name, { viewpoint, ...extra });
    v.nodes = nodes.map(([e, x, y, w, h, parent]): ViewNode => ({ element: e.id, x, y, w: w ?? 190, h: h ?? 100, ...(parent ? { parent: parent.id } : {}) }));
    const present = new Set(v.nodes.map((n) => n.element));
    const also = (extra.properties?.alsoShow as string | undefined)?.split(",") ?? [];
    if (v.properties.alsoShow) delete v.properties.alsoShow;
    v.edges = Object.values(ws.relationships)
      .filter((r) => present.has(r.source) && present.has(r.target) && [notation, ...also].some((n) => r.type.startsWith(n + ":")))
      .map((r) => ({ relationship: r.id }));
    ws.views[v.id] = v;
    return v;
  };

  // --- people and systems (C4 is their primary notation) ---
  const customer = el("c4:Person", "Customer", "Someone who buys from the shop.");
  const agent = el("c4:Person", "Support Agent", "Helps customers with orders and returns.");
  const shop = el("c4:SoftwareSystem", "Online Shop", "Lets customers browse the catalogue, place orders and pay.", {
    owner: "Team Checkout",
    tags: ["customer-facing", "tier-1"],
    lifecycle: { phase: "active", dates: { active: "2021-03-01" } },
    properties: {
      criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 420000, admPhase: "C: Information Systems Architectures",
      purpose: "Take an order from basket to confirmed payment.", domainClassification: "Core", businessModel: "Revenue", evolution: "Custom built",
      ubiquitousLanguage: "Basket: items a customer intends to buy.\nOrder: a basket the customer has committed to.\nPayment: money taken for an order.",
      businessDecisions: "An order is only confirmed once payment is authorised.",
    },
    links: [{ kind: "repo", href: "https://example.com/acme/online-shop" }, { kind: "runbook", href: "https://example.com/runbooks/online-shop" }],
  });
  const pay = el("c4:SoftwareSystem", "Payment Provider", "Third-party service that authorises and captures card payments.", {
    owner: "Finance", tags: ["external"], lifecycle: { phase: "active" },
    properties: { location: "External", criticality: "Mission critical", technicalFit: "Excellent", annualCost: 90000 },
    facets: { ddd: { type: "ddd:ExternalSystem" } },
  });
  const wms = el("c4:SoftwareSystem", "Warehouse System", "Legacy system that picks, packs and ships orders.", {
    owner: "Team Fulfilment", tags: ["legacy"], lifecycle: { phase: "phaseOut", dates: { active: "2014-06-01", phaseOut: "2026-09-01", endOfLife: "2027-06-30" } },
    properties: { criticality: "Business critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 150000, admPhase: "F: Migration Planning" },
  });
  const platform = el("c4:SoftwareSystem", "Fulfilment Platform", "Planned replacement for the Warehouse System.", {
    owner: "Team Fulfilment", lifecycle: { phase: "plan", dates: { plan: "2026-01-15", phaseIn: "2026-10-01", active: "2027-04-01" } },
    properties: { criticality: "Business critical", technicalFit: "Excellent", annualCost: 110000, admPhase: "E: Opportunities and Solutions" },
  });
  const mail = el("c4:SoftwareSystem", "Email Service", "Sends order confirmations and shipping updates.", {
    owner: "Platform", tags: ["external"], lifecycle: { phase: "active" }, properties: { location: "External", criticality: "Business operational", technicalFit: "Adequate", annualCost: 12000 },
  });
  const crm = el("c4:SoftwareSystem", "CRM", "Customer records and support cases.", { lifecycle: { phase: "active" }, properties: { criticality: "Business operational", technicalFit: "Adequate", annualCost: 60000 } });

  // --- containers and components ---
  const web = el("c4:Container", "Web App", "The storefront customers use in their browser.", { parent: shop.id, owner: "Team Checkout", properties: { technology: "React" } });
  const api = el("c4:Container", "Order API", "Accepts orders and coordinates payment.", { parent: shop.id, owner: "Team Checkout", properties: { technology: "Node.js" } });
  const catalog = el("c4:Container", "Catalog Service", "Product data and search.", { parent: shop.id, owner: "Team Catalogue", properties: { technology: "Go" } });
  const db = el("c4:Container", "Orders DB", "Orders, order lines and payment state.", { parent: shop.id, owner: "Team Checkout", properties: { technology: "PostgreSQL", kind: "Database" } });
  const bus = el("c4:Container", "Event Bus", "Carries order events to other systems.", { parent: shop.id, owner: "Platform", properties: { technology: "Kafka", kind: "Queue" } });
  const ordersCtl = el("c4:Component", "Orders Controller", "HTTP endpoints for placing and reading orders.", { parent: api.id, properties: { technology: "Express router" } });
  const payClient = el("c4:Component", "Payment Client", "Wraps the payment provider's API.", { parent: api.id, properties: { technology: "TypeScript module" } });

  rel("c4:Uses", customer, web, "Browses and places orders using", "HTTPS");
  rel("c4:Uses", web, api, "Places orders via", "JSON/HTTPS");
  rel("c4:Uses", web, catalog, "Searches products via", "JSON/HTTPS");
  rel("c4:Uses", api, db, "Reads from and writes to", "SQL");
  rel("c4:Uses", api, bus, "Publishes OrderPlaced to", "Kafka");
  rel("c4:Uses", ordersCtl, payClient, "Takes payment using");
  rel("c4:Uses", payClient, pay, "Authorises card payments with", "HTTPS");
  rel("c4:Uses", api, mail, "Sends confirmations using", "SMTP");
  rel("c4:Uses", wms, bus, "Consumes OrderPlaced from", "Kafka");
  rel("c4:Uses", agent, crm, "Looks up customers in");
  rel("c4:Uses", agent, shop, "Handles returns in");
  rel("c4:Uses", crm, api, "Reads order history from", "JSON/HTTPS");

  // --- ArchiMate: capabilities, a service and a data object, linked to the same systems ---
  const cap = (name: string, parent?: Element, props: Record<string, string | number> = {}) => el("archimate:Capability", name, `The ability to ${name.toLowerCase()}.`, { ...(parent ? { parent: parent.id } : {}), properties: props });
  const sales = cap("Sales", undefined, { functionalFit: "Adequate" });
  const orderMgmt = cap("Order Management", sales, { functionalFit: "Excellent", annualCost: 420000 });
  const payments = cap("Payments", sales, { functionalFit: "Excellent", annualCost: 90000 });
  const catalogue = cap("Product Catalogue", sales, { functionalFit: "Adequate", annualCost: 80000 });
  const fulfil = cap("Fulfilment", undefined, { functionalFit: "Insufficient" });
  const warehousing = cap("Warehousing", fulfil, { functionalFit: "Insufficient", annualCost: 150000 });
  const shipping = cap("Shipping", fulfil, { functionalFit: "Adequate", annualCost: 40000 });
  const care = cap("Customer Care", undefined, { functionalFit: "Adequate", annualCost: 60000 });
  const orderSvc = el("archimate:Service", "Order placement", "Lets a customer turn a basket into a paid order.", { properties: { domain: "Application" } });
  const orderData = el("archimate:DataObject", "Order", "An order with its lines and payment state.");
  rel("archimate:Realization", shop, orderSvc);
  rel("archimate:Serving", orderSvc, customer);
  rel("archimate:Access", shop, orderData).properties.accessType = "ReadWrite";
  rel("archimate:Access", wms, orderData).properties.accessType = "Read";
  rel("archimate:Realization", shop, orderMgmt);
  rel("archimate:Realization", shop, catalogue);
  rel("archimate:Realization", pay, payments);
  rel("archimate:Realization", wms, warehousing);
  rel("archimate:Realization", wms, shipping);
  rel("archimate:Realization", platform, warehousing);
  rel("archimate:Realization", crm, care);

  // --- DDD: subdomains, a team, strategic patterns between the same systems, and an event storm ---
  const domain = el("ddd:Domain", "E-commerce", "Selling goods online and getting them to customers.");
  const ordering = el("ddd:Subdomain", "Ordering", "Where the business competes: a fast, reliable checkout.", { parent: domain.id, properties: { subdomainType: "Core" } });
  el("ddd:Subdomain", "Payments (subdomain)", "Taking money safely; bought, not built.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  el("ddd:Subdomain", "Fulfilment (subdomain)", "Getting parcels out of the door.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  const team = el("ddd:Team", "Team Checkout", "Owns ordering and payment integration.");
  rel("ddd:Implements", shop, ordering);
  rel("ddd:Owns", team, shop);
  rel("ddd:AnticorruptionLayer", pay, shop, "payment authorisations").properties.downstreamRoles = "ACL";
  rel("ddd:CustomerSupplier", shop, wms, "paid orders");
  rel("ddd:Conformist", mail, shop);

  const sticky = (type: string, name: string, description: string) => el(type, name, description, { parent: shop.id });
  const cPlace = sticky("ddd:Command", "Place order", "A customer submits their basket.");
  const aOrder = sticky("ddd:Aggregate", "Order (aggregate)", "Keeps an order consistent.");
  const ePlaced = sticky("ddd:DomainEvent", "Order placed", "An order was accepted.");
  const pCharge = sticky("ddd:Policy", "Charge when placed", "Whenever an order is placed, take payment.");
  const cPay = sticky("ddd:Command", "Take payment", "Ask the provider to authorise the card.");
  const ePaid = sticky("ddd:DomainEvent", "Payment received", "The provider authorised the payment.");
  const pShip = sticky("ddd:Policy", "Ship when paid", "Whenever payment is received, release the order.");
  const cShip = sticky("ddd:Command", "Ship order", "Tell the warehouse to dispatch.");
  const eShipped = sticky("ddd:DomainEvent", "Order shipped", "The parcel left the warehouse.");
  const rStatus = sticky("ddd:ReadModel", "Order status", "What the customer sees on the order page.");
  for (const [a, b] of [[cPlace, aOrder], [aOrder, ePlaced], [ePlaced, pCharge], [pCharge, cPay], [cPay, ePaid], [ePaid, pShip], [pShip, cShip], [cShip, eShipped], [ePlaced, rStatus], [eShipped, rStatus]] as const) rel("ddd:Triggers", a, b);

  // --- TOGAF building blocks ---
  const abb = el("togaf:ArchitectureBuildingBlock", "Card payment capability", "Accept card payments with strong customer authentication.", { properties: { admPhase: "B: Business Architecture" } });
  const sbb = el("togaf:SolutionBuildingBlock", "Hosted payment page", "The provider's hosted checkout, embedded in the storefront.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  rel("togaf:Realizes", sbb, abb);
  rel("togaf:Uses", sbb, pay);

  // --- views ---
  view("c4", "c4:landscape", "System landscape", [[customer, 60, 40, 150, 150], [agent, 660, 40, 150, 150], [shop, 280, 260, 200, 110], [crm, 640, 260, 200, 110], [pay, 40, 470, 200, 110], [mail, 280, 470, 200, 110], [wms, 520, 470, 200, 110], [platform, 760, 470, 200, 110]], {
    properties: { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" },
  });
  view("c4", "c4:context", "Online Shop – context", [[customer, 80, 20, 150, 150], [agent, 420, 20, 150, 150], [shop, 230, 240, 200, 110], [pay, 20, 440, 200, 110], [mail, 250, 440, 200, 110], [wms, 480, 440, 200, 110], [crm, 620, 240, 200, 110]], { subject: shop.id });
  view("c4", "c4:container", "Online Shop – containers", [
    [customer, 300, 0, 150, 150],
    [shop, 60, 220, 690, 420],
    [web, 250, 50, 190, 110, shop], [api, 250, 250, 190, 110, shop], [catalog, 470, 50, 190, 110, shop], [db, 30, 250, 170, 110, shop], [bus, 480, 260, 180, 90, shop],
    [pay, 60, 720, 200, 110], [mail, 310, 720, 200, 110], [wms, 560, 720, 200, 110], [crm, 820, 440, 200, 110],
  ], { subject: shop.id, properties: { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" } });
  view("c4", "c4:component", "Order API – components", [[api, 120, 160, 480, 220], [ordersCtl, 30, 60, 180, 100, api], [payClient, 270, 60, 180, 100, api], [web, 60, 0, 190, 110], [pay, 420, 450, 200, 110], [db, 100, 450, 170, 110]], { subject: api.id });

  view("archimate", "archimate:application", "Application landscape (ArchiMate)", [[customer, 60, 30, 150, 65], [orderSvc, 290, 30, 170, 65], [shop, 280, 170, 190, 75], [pay, 40, 320, 190, 75], [wms, 520, 320, 190, 75], [mail, 280, 320, 190, 75], [orderData, 540, 170, 150, 65], [crm, 60, 170, 170, 75]], {
    // this ArchiMate view also shows the C4 "uses" relationships between the same elements
    properties: { admPhase: "C: Information Systems Architectures", architectureDomain: "Application", alsoShow: "c4" },
  });
  view("archimate", "archimate:capability-map", "Capability map (ArchiMate)", [
    [sales, 40, 40, 560, 160], [orderMgmt, 20, 60, 160, 70, sales], [payments, 200, 60, 160, 70, sales], [catalogue, 380, 60, 160, 70, sales],
    [fulfil, 40, 230, 380, 160], [warehousing, 20, 60, 160, 70, fulfil], [shipping, 200, 60, 160, 70, fulfil],
    [care, 450, 290, 150, 70],
  ], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });

  view("ddd", "ddd:context-map", "Context map", [[shop, 300, 180, 210, 120], [pay, 20, 190, 180, 90], [wms, 620, 190, 210, 120], [mail, 310, 400, 180, 90], [team, 340, 0, 130, 130]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  view("ddd", "ddd:event-storming", "Order to shipment (event storm)", [
    [cPlace, 0, 60, 130, 90], [aOrder, 160, 60, 130, 90], [ePlaced, 320, 60, 130, 90], [pCharge, 480, 60, 130, 90], [cPay, 640, 60, 130, 90], [ePaid, 800, 60, 130, 90], [pShip, 960, 60, 130, 90], [cShip, 1120, 60, 130, 90], [eShipped, 1280, 60, 130, 90], [rStatus, 800, 230, 130, 90],
  ]);
  const canvas = makeView("ddd", "Online Shop – Bounded Context Canvas", { viewpoint: "ddd:canvas", subject: shop.id });
  ws.views[canvas.id] = canvas;
  view("togaf", "togaf:building-blocks", "Payment building blocks", [[abb, 60, 40, 190, 80], [sbb, 60, 200, 190, 80], [pay, 330, 200, 190, 80]], { properties: { admPhase: "E: Opportunities and Solutions", architectureDomain: "Application" } });

  // --- a whiteboard flowchart, to show the generic notation and Formalise ---
  const g = (type: string, name: string) => el(type, name, "");
  const start = g("generic:StartEnd", "Basket submitted");
  const takePay = g("generic:Process", "Authorise card");
  const ok = g("generic:Decision", "Authorised?");
  const confirm = g("generic:Process", "Confirm order");
  const fail = g("generic:StartEnd", "Ask for another card");
  rel("generic:Arrow", start, takePay);
  rel("generic:Arrow", takePay, ok);
  rel("generic:Arrow", ok, confirm, "yes");
  rel("generic:Arrow", ok, fail, "no");
  view("generic", "generic:flowchart", "Checkout flow (whiteboard)", [[start, 200, 40, 150, 60], [takePay, 200, 150, 150, 70], [ok, 210, 270, 130, 90], [confirm, 70, 420, 150, 70], [fail, 330, 425, 170, 60]]);

  // --- decisions ---
  ws.adrs["0001"] = { id: "0001", title: "Use an event bus between ordering and fulfilment", status: "accepted", date: "2024-02-12", elements: [bus.id, api.id, wms.id], body: "## Context\n\nThe Order API called the Warehouse System directly, so a warehouse outage stopped checkout.\n\n## Decision\n\nPublish `OrderPlaced` to an event bus. The warehouse consumes it at its own pace.\n\n## Consequences\n\nCheckout no longer depends on warehouse availability. Fulfilment is eventually consistent." };
  ws.adrs["0002"] = { id: "0002", title: "Replace the Warehouse System", status: "proposed", date: "2026-01-15", elements: [wms.id, platform.id], body: "## Context\n\nThe Warehouse System is out of vendor support in mid-2027 and scores poorly on technical fit.\n\n## Decision\n\nIntroduce the Fulfilment Platform and move warehouses over one at a time.\n\n## Consequences\n\nBoth systems consume order events during the transition." };
  ws.savedFilters = [{ name: "No owner", query: "no:owner", types: [] }, { name: "Phasing out", query: "phase:phaseout", types: [] }];
  return ws;
}
