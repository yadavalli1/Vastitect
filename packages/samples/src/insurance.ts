import type { Workspace } from "@vastitecture/core";
import { SampleBuilder, group } from "./builder";

/**
 * Insurance: a property and casualty insurer selling home and motor policies direct and through
 * brokers, replacing its policy administration system and automating claims. All names are fictional.
 */
export function buildInsurance(): Workspace {
  const b = new SampleBuilder("Sample: Harbour Mutual (property & casualty insurance)");

  const holder = b.person("Policyholder", "Buys and renews policies and makes claims.");
  const broker = b.person("Broker", "Sells the insurer's products to clients and earns commission.");
  const handler = b.person("Claims Handler", "Assesses claims, appoints suppliers and pays settlements.");
  const underwriter = b.person("Underwriter", "Prices and accepts risks outside the automatic rules.");

  const portal = b.system("Customer Portal", "Quotes, policy documents, renewals and claim notification online.", {
    owner: "Digital", tags: ["customer-facing"], phase: "active", dates: { active: "2020-02-01" },
    criticality: "Business critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 540000, monthlyCost: 45000, data: "confidential",
  });
  const brokerHub = b.system("Broker Platform", "Quote-and-bind for brokers, with commission statements.", {
    owner: "Distribution", phase: "active", criticality: "Business critical", technicalFit: "Adequate", functionalFit: "Adequate", annualCost: 360000, monthlyCost: 30000, data: "confidential",
  });
  const rating = b.system("Rating Engine", "Prices risks from rating tables, external data and underwriting rules.", {
    owner: "Pricing", tags: ["tier-1"], phase: "active", criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Excellent", annualCost: 480000, monthlyCost: 40000, data: "internal",
    props: { domainClassification: "Core", businessModel: "Revenue", evolution: "Custom built", purpose: "Price every risk accurately and fast.", ubiquitousLanguage: "Risk: the thing insured.\nPremium: the price of cover.\nLoading: an addition to the base premium for a risk factor." },
  });
  const legacyPas = b.system("Policy Admin (legacy)", "Policies, endorsements, renewals and billing on a 1990s package.", {
    owner: "Core Insurance", tags: ["legacy", "system-of-record"], phase: "phaseOut", dates: { active: "1996-04-01", phaseOut: "2026-01-01", endOfLife: "2027-12-31" },
    criticality: "Mission critical", technicalFit: "Unreasonable", functionalFit: "Insufficient", annualCost: 2100000, monthlyCost: 175000, data: "confidential", admPhase: "F: Migration Planning",
  });
  const pas = b.system("Policy Platform", "SaaS policy administration that replaces the legacy system, line by line.", {
    owner: "Core Insurance", tags: ["system-of-record"], phase: "phaseIn", dates: { plan: "2024-09-01", phaseIn: "2025-10-01", active: "2026-09-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 1300000, monthlyCost: 108000, data: "confidential", admPhase: "E: Opportunities and Solutions",
  });
  const claims = b.system("Claims Platform", "First notification of loss through to settlement and recovery.", {
    owner: "Claims", tags: ["tier-1"], phase: "active", dates: { active: "2021-07-01" },
    criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Adequate", annualCost: 900000, monthlyCost: 75000, data: "restricted",
    props: { domainClassification: "Core", businessModel: "Cost reduction", evolution: "Product", purpose: "Settle valid claims quickly and fairly, and spot fraud." },
  });
  const fraudSvc = b.system("Claims Fraud Scoring", "Network analytics that flag suspicious claims.", { owner: "Claims", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 220000, monthlyCost: 18000, external: true, data: "restricted" });
  const docs = b.system("Document Generation", "Policy schedules, certificates and letters.", { owner: "Core Insurance", phase: "active", criticality: "Business operational", technicalFit: "Adequate", annualCost: 140000, monthlyCost: 12000, data: "confidential" });
  const billing = b.system("Billing & Collections", "Instalments, direct debits and arrears.", { owner: "Finance", phase: "active", criticality: "Business critical", technicalFit: "Insufficient", annualCost: 260000, monthlyCost: 22000, data: "confidential" });
  const finance = b.system("Finance & Actuarial", "General ledger, reserving and Solvency II reporting.", { owner: "Finance", tags: ["regulatory"], phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 650000, monthlyCost: 54000, data: "confidential" });
  const dataVendor = b.system("Property & Vehicle Data", "Address, flood, vehicle and claims history data from bureaus.", { external: true, phase: "active", criticality: "Business critical", annualCost: 300000, data: "internal" });
  const suppliers = b.system("Repair Network", "Approved garages and builders, paid through a supplier portal.", { external: true, phase: "active", data: "confidential" });

  const fnol = b.container(claims, "FNOL Service", "Takes first notification of loss from web, phone and brokers.", "Java");
  const triage = b.container(claims, "Triage Rules", "Routes claims to fast-track, a handler or the fraud team.", "Decision tables");
  const workbench = b.container(claims, "Handler Workbench", "Where handlers work their claims.", "Angular");
  const settle = b.container(claims, "Settlement Service", "Calculates and pays settlements, reserves and recoveries.", "Java");
  const claimsDb = b.container(claims, "Claims DB", "Claims, reserves, payments and documents.", "Oracle", { kind: "Database", data: "restricted" });

  b.rel("c4:Uses", holder, portal, "Gets quotes and reports claims with", "HTTPS");
  b.rel("c4:Uses", broker, brokerHub, "Quotes and binds policies in", "HTTPS");
  b.rel("c4:Uses", portal, rating, "Gets prices from", "JSON/HTTPS");
  b.rel("c4:Uses", brokerHub, rating, "Gets prices from", "JSON/HTTPS");
  b.rel("c4:Uses", rating, dataVendor, "Enriches risks with", "REST");
  b.rel("c4:Uses", underwriter, rating, "Refers and overrides prices in");
  b.rel("c4:Uses", portal, pas, "Binds and renews policies in", "REST");
  b.rel("c4:Uses", brokerHub, legacyPas, "Binds commercial policies in", "SOAP");
  b.rel("c4:Uses", pas, docs, "Produces schedules with", "REST");
  b.rel("c4:Uses", legacyPas, docs, "Produces schedules with", "Batch");
  b.rel("c4:Uses", pas, billing, "Sets up instalments in", "Events");
  b.rel("c4:Uses", legacyPas, billing, "Sets up instalments in", "Batch");
  b.rel("c4:Uses", portal, fnol, "Reports claims to", "JSON/HTTPS");
  b.rel("c4:Uses", fnol, pas, "Checks cover with", "REST");
  b.rel("c4:Uses", fnol, legacyPas, "Checks cover with", "SOAP");
  b.rel("c4:Uses", fnol, triage, "Sends new claims to");
  b.rel("c4:Uses", triage, fraudSvc, "Asks for a fraud score from", "REST");
  b.rel("c4:Uses", handler, workbench, "Works claims in", "HTTPS");
  b.rel("c4:Uses", workbench, settle, "Authorises payments in");
  b.rel("c4:Uses", fnol, claimsDb, "Stores claims in", "SQL");
  b.rel("c4:Uses", settle, claimsDb, "Reads and writes reserves in", "SQL");
  b.rel("c4:Uses", settle, suppliers, "Instructs and pays repairers in", "REST");
  b.rel("c4:Uses", settle, finance, "Posts payments and reserves to", "Batch");
  b.rel("c4:Uses", billing, finance, "Posts premium to", "Batch");

  // ArchiMate
  const distribution = b.capability("Distribution", "Sell policies through every channel.", undefined, "Adequate");
  const direct = b.capability("Direct Sales", "Quote and sell online.", distribution, "Adequate", 540000);
  const brokerMgmt = b.capability("Broker Management", "Onboard brokers and pay commission.", distribution, "Adequate", 360000);
  const uw = b.capability("Underwriting", "Decide which risks to accept and at what price.", undefined, "Excellent");
  const pricing = b.capability("Pricing", "Calculate premiums.", uw, "Excellent", 480000);
  const riskAssess = b.capability("Risk Assessment", "Understand the insured risk from data.", uw, "Adequate", 300000);
  const policyMgmt = b.capability("Policy Management", "Issue, change and renew policies.", undefined, "Insufficient");
  const issuance = b.capability("Policy Issuance", "Bind cover and send documents.", policyMgmt, "Insufficient", 2100000);
  const renewals = b.capability("Renewals", "Re-price and renew at term.", policyMgmt, "Insufficient");
  const claimsCap = b.capability("Claims Management", "Handle claims from notification to settlement.", undefined, "Adequate");
  const fnolCap = b.capability("Loss Notification", "Take claims from any channel.", claimsCap, "Excellent", 200000);
  const assessment = b.capability("Claims Assessment", "Validate cover and quantum.", claimsCap, "Adequate", 500000);
  const fraudCap = b.capability("Claims Fraud Detection", "Stop fraudulent claims.", claimsCap, "Adequate", 220000);
  const financeCap = b.capability("Finance & Reporting", "Reserve, account and report.", undefined, "Adequate", 650000);
  for (const [s, c] of [[portal, direct], [brokerHub, brokerMgmt], [rating, pricing], [dataVendor, riskAssess], [legacyPas, issuance], [pas, issuance], [pas, renewals], [fnol, fnolCap], [workbench, assessment], [fraudSvc, fraudCap], [finance, financeCap]] as const) b.rel("archimate:Realization", s, c);

  const vs = b.el("archimate:ValueStream", "Claim to settlement", "From the moment of loss to money paid.");
  const s1 = b.el("archimate:ValueStream", "Report loss", "The policyholder tells us what happened.");
  const s2 = b.el("archimate:ValueStream", "Validate cover", "Check the policy covers the loss.");
  const s3 = b.el("archimate:ValueStream", "Assess and repair", "Agree the cost; repair or replace.");
  const s4 = b.el("archimate:ValueStream", "Settle", "Pay and close the claim.");
  for (const s of [s1, s2, s3, s4]) b.rel("archimate:Composition", vs, s);
  b.chain("archimate:Flow", s1, s2, s3, s4);
  b.rel("archimate:Serving", fnolCap, s1);
  b.rel("archimate:Serving", assessment, s2);
  b.rel("archimate:Serving", assessment, s3);
  b.rel("archimate:Serving", fraudCap, s3);

  const solvency = b.el("archimate:Driver", "Solvency II", "Capital and reporting regime for insurers.");
  const consumerDuty = b.el("archimate:Driver", "Fair value for customers", "Regulators expect fair prices at renewal and fast, fair claims.");
  const goalClaims = b.el("archimate:Goal", "Settle simple claims in 48 hours", "Fast-track straightforward claims without a handler.");
  const reqPricing = b.el("archimate:Requirement", "No price walking at renewal", "Renewal prices are no higher than for an equivalent new customer.");
  b.rel("archimate:Influence", consumerDuty, goalClaims);
  b.rel("archimate:Influence", consumerDuty, reqPricing);
  b.rel("archimate:Realization", rating, reqPricing);
  b.rel("archimate:Realization", claims, goalClaims);
  const reqSolvency = b.el("archimate:Requirement", "Quarterly solvency returns", "Solvency capital and reporting templates every quarter.");
  b.rel("archimate:Influence", solvency, reqSolvency);
  b.rel("archimate:Realization", finance, reqSolvency);

  // DDD
  const domain = b.el("ddd:Domain", "General Insurance", "Home and motor cover for individuals and small firms.");
  const sdUw = b.el("ddd:Subdomain", "Underwriting (subdomain)", "Pricing risk better than competitors.", { parent: domain.id, properties: { subdomainType: "Core" } });
  const sdClaims = b.el("ddd:Subdomain", "Claims (subdomain)", "Claims experience decides renewals.", { parent: domain.id, properties: { subdomainType: "Core" } });
  b.el("ddd:Subdomain", "Billing (subdomain)", "Collecting premium.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  b.el("ddd:Subdomain", "Documents (subdomain)", "Producing letters and schedules.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  const teamClaims = b.el("ddd:Team", "Team Claims", "Owns the Claims Platform.");
  const teamPricing = b.el("ddd:Team", "Team Pricing", "Owns the Rating Engine.");
  b.rel("ddd:Implements", rating, sdUw);
  b.rel("ddd:Implements", claims, sdClaims);
  b.rel("ddd:Owns", teamClaims, claims);
  b.rel("ddd:Owns", teamPricing, rating);
  b.rel("ddd:CustomerSupplier", pas, claims, "policy and cover");
  b.rel("ddd:AnticorruptionLayer", legacyPas, claims, "legacy policies").properties.downstreamRoles = "ACL";
  b.rel("ddd:OpenHostService", rating, portal, "pricing API");
  b.rel("ddd:OpenHostService", rating, brokerHub, "pricing API");
  b.rel("ddd:Conformist", pas, docs);

  const st = (type: string, name: string, description: string) => b.el(type, name, description, { parent: claims.id });
  const cReport = st("ddd:Command", "Report claim", "The policyholder reports a loss.");
  const aClaim = st("ddd:Aggregate", "Claim", "Keeps a claim's cover, reserve and payments consistent.");
  const eReported = st("ddd:DomainEvent", "Claim reported", "A claim was registered against a policy.");
  const pTriage = st("ddd:Policy", "Triage every new claim", "Route by value, type and fraud score.");
  const eFast = st("ddd:DomainEvent", "Claim fast-tracked", "Low value, clear cover, low fraud score.");
  const cPay = st("ddd:Command", "Pay settlement", "Pay the policyholder or the repairer.");
  const eSettled = st("ddd:DomainEvent", "Claim settled", "Payment made and claim closed.");
  const rStatus = st("ddd:ReadModel", "Claim status", "What the policyholder sees in the portal.");
  b.chain("ddd:Triggers", cReport, aClaim, eReported, pTriage, eFast, cPay, eSettled, rStatus);

  // TOGAF
  const abb = b.el("togaf:ArchitectureBuildingBlock", "Policy administration", "Issue, change, renew and cancel policies for every line.", { properties: { admPhase: "B: Business Architecture" } });
  const sbb = b.el("togaf:SolutionBuildingBlock", "SaaS policy platform", "Configured, not customised, per line of business.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  b.rel("togaf:Realizes", sbb, abb);
  b.rel("togaf:Uses", sbb, pas);

  // views
  const app_ = { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" };
  b.rows("c4", "c4:landscape", "Insurer landscape", [[holder, broker, underwriter, handler], [portal, brokerHub, rating, claims], [legacyPas, pas, docs, billing, finance], [dataVendor, fraudSvc, suppliers]], { properties: app_ });
  b.rows("c4", "c4:container", "Claims Platform – containers", [[holder, handler], [portal, group(claims, [fnol, triage], [workbench, settle, claimsDb])], [pas, legacyPas, fraudSvc, suppliers, finance]], { subject: claims.id, properties: app_ });
  b.rows("c4", "c4:context", "Rating Engine – context", [[holder, broker, underwriter], [portal, brokerHub], [rating], [dataVendor]], { subject: rating.id });
  b.rows("archimate", "archimate:capability-map", "Capability map", [[group(distribution, [direct, brokerMgmt]), group(uw, [pricing, riskAssess]), group(policyMgmt, [issuance, renewals])], [group(claimsCap, [fnolCap, assessment, fraudCap]), financeCap]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  b.rows("archimate", "archimate:value-stream", "Claim to settlement (value stream)", [[group(vs, [s1, s2, s3, s4])], [fnolCap, assessment, fraudCap]], { properties: { architectureDomain: "Business" } });
  b.rows("archimate", "archimate:motivation", "Regulation and goals", [[solvency, consumerDuty], [reqSolvency, goalClaims, reqPricing]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:requirements-realization", "How requirements are met", [[reqSolvency, goalClaims, reqPricing], [finance, claims, rating]], { properties: { admPhase: "Requirements Management" } });
  b.rows("ddd", "ddd:context-map", "Context map", [[teamPricing, teamClaims], [portal, rating, brokerHub], [pas, claims, legacyPas, docs]], { properties: { architectureDomain: "Business" } });
  b.rows("ddd", "ddd:event-storming", "Fast-track a claim (event storm)", [[cReport, aClaim, eReported, pTriage], [eFast, cPay, eSettled, rStatus]]);
  b.canvas("Claims – Bounded Context Canvas", claims);
  b.rows("togaf", "togaf:building-blocks", "Policy administration building blocks", [[abb], [sbb], [pas]], { properties: { admPhase: "E: Opportunities and Solutions" } });

  b.adr("0001", "Replace the legacy policy system with a SaaS platform", "accepted", "2024-09-01", [legacyPas, pas], "## Context\n\nThe legacy policy system needs specialist skills, takes months to launch a product and leaves support at the end of 2027.\n\n## Decision\n\nMove to a SaaS policy platform, home first, then motor, then commercial. Configure; do not customise.\n\n## Consequences\n\nClaims and billing read policies from both systems until the last line moves.");
  b.adr("0002", "Fast-track low-value claims automatically", "proposed", "2026-02-20", [triage, fraudSvc, settle], "## Context\n\nMost glass and small water claims are paid in full after weeks of handling.\n\n## Decision\n\nClaims under a threshold, with clear cover and a low fraud score, are paid without a handler.\n\n## Consequences\n\nHandlers focus on complex claims. The threshold and score cut-off are reviewed monthly.");
  b.ws.rules = [
    { id: "systems-have-owners", description: "Every system has an accountable owner.", severity: "warning", match: { type: "c4:SoftwareSystem", tag: "system-of-record" }, require: ["owner", "lifecycle"] },
    { id: "no-new-legacy-dependencies", description: "Nothing new may depend on the legacy policy system.", severity: "info", forbid: { to: { tag: "legacy" }, from: { lifecycle: ["plan", "phaseIn"] } } },
  ];
  b.ws.savedFilters = [{ name: "Phasing out", query: "phase:phaseout", types: [] }, { name: "Claims", query: "owner:Claims", types: [] }];
  return b.ws;
}
