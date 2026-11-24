import type { Workspace } from "@vastitecture/core";
import { SampleBuilder, group } from "./builder";

/**
 * Banking: a retail bank moving off a mainframe core, with real-time payments, open banking (PSD2),
 * card payments kept out of its own systems, and fraud and anti-money-laundering screening.
 * All names are fictional.
 */
export function buildBanking(): Workspace {
  const b = new SampleBuilder("Sample: Northbridge Bank (retail banking)");

  // --- people ---
  const customer = b.person("Retail Customer", "Holds current and savings accounts, cards and loans.");
  const advisor = b.person("Branch Advisor", "Opens accounts and sells loans in branches and over the phone.");
  const analyst = b.person("Fraud Analyst", "Reviews payments the fraud engine flags.");
  const tpp = b.person("Third-Party Provider", "A fintech the customer has allowed to read accounts or start payments (PSD2).");

  // --- systems ---
  const digital = b.system("Digital Banking", "Mobile and web banking: balances, payments, cards and onboarding.", {
    owner: "Digital Channels", tags: ["customer-facing", "tier-1"], phase: "active", dates: { active: "2019-05-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 1800000, monthlyCost: 150000, data: "confidential",
    admPhase: "C: Information Systems Architectures",
    props: {
      purpose: "Let customers do everyday banking without a branch.", domainClassification: "Core", businessModel: "Engagement", evolution: "Custom built",
      ubiquitousLanguage: "Payee: someone a customer pays regularly.\nStanding order: a fixed payment on a schedule.\nStrong customer authentication: two independent factors before a payment.",
      businessDecisions: "A new payee needs strong customer authentication before the first payment.",
    },
    links: [{ kind: "repo", href: "https://example.com/northbridge/digital-banking" }],
  });
  const core = b.system("Core Banking (mainframe)", "Accounts, balances, interest and the general ledger. COBOL on z/OS.", {
    owner: "Core Platforms", tags: ["legacy", "system-of-record"], phase: "phaseOut", dates: { active: "1998-01-01", phaseOut: "2026-07-01", endOfLife: "2028-12-31" },
    criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 6200000, monthlyCost: 516000, data: "restricted",
    admPhase: "F: Migration Planning",
  });
  const cloudCore = b.system("Cloud Core Banking", "Cloud-native core that takes over accounts product by product.", {
    owner: "Core Platforms", tags: ["system-of-record"], phase: "phaseIn", dates: { plan: "2025-01-15", phaseIn: "2026-03-01", active: "2027-06-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 2400000, monthlyCost: 200000, data: "restricted",
    admPhase: "E: Opportunities and Solutions",
  });
  const payments = b.system("Payments Hub", "Domestic and SEPA instant payments in ISO 20022, with routing and limits.", {
    owner: "Payments", tags: ["tier-1"], phase: "active", dates: { active: "2022-11-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Excellent", annualCost: 950000, monthlyCost: 79000, data: "restricted",
    props: { domainClassification: "Core", businessModel: "Revenue", evolution: "Custom built", purpose: "Move money in seconds, safely." },
  });
  const fraud = b.system("Fraud Engine", "Scores every payment and card transaction in real time.", {
    owner: "Financial Crime", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 640000, monthlyCost: 53000, data: "confidential",
  });
  const aml = b.system("KYC & AML Screening", "Identity verification, sanctions and PEP screening, from a vendor.", {
    owner: "Financial Crime", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 380000, monthlyCost: 32000, external: true, data: "confidential",
  });
  const cards = b.system("Card Processor", "Issues debit cards and authorises card transactions. Holds the card numbers so the bank does not.", {
    owner: "Cards", phase: "active", criticality: "Mission critical", technicalFit: "Excellent", annualCost: 1200000, monthlyCost: 100000, external: true, data: "restricted",
  });
  const openBanking = b.system("Open Banking Gateway", "PSD2 APIs for account information and payment initiation, with consent management.", {
    owner: "Digital Channels", tags: ["regulatory"], phase: "active", dates: { active: "2019-09-14" },
    criticality: "Business critical", technicalFit: "Adequate", functionalFit: "Adequate", annualCost: 420000, monthlyCost: 35000, data: "confidential",
  });
  const lending = b.system("Loan Origination", "Applications, credit decisions and offers for personal loans and mortgages.", {
    owner: "Lending", phase: "active", criticality: "Business critical", technicalFit: "Adequate", functionalFit: "Insufficient", annualCost: 700000, monthlyCost: 58000, data: "confidential",
  });
  const crm = b.system("CRM", "Customer records, contact history and complaints.", {
    owner: "Customer Operations", phase: "active", criticality: "Business operational", technicalFit: "Adequate", annualCost: 520000, monthlyCost: 43000, data: "confidential",
  });
  const iam = b.system("Customer Identity", "Logins, devices and strong customer authentication.", {
    owner: "Security", phase: "active", criticality: "Mission critical", technicalFit: "Excellent", annualCost: 300000, monthlyCost: 25000, data: "confidential",
  });
  const dwh = b.system("Regulatory Reporting", "Data warehouse that builds regulatory returns (liquidity, capital, transaction reports).", {
    owner: "Finance", tags: ["regulatory"], phase: "active", criticality: "Business critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 610000, monthlyCost: 51000, data: "restricted",
  });
  const regulator = b.system("Central Bank Reporting Portal", "Where returns are submitted.", { owner: "Finance", external: true, phase: "active", data: "restricted" });

  // --- containers of Digital Banking ---
  const app = b.container(digital, "Mobile App", "iOS and Android app.", "Swift, Kotlin");
  const web = b.container(digital, "Web Banking", "Browser version of the app.", "React");
  const bff = b.container(digital, "Banking API", "Backend for the apps: orchestrates core, payments and cards.", "Java, Spring Boot");
  const profile = b.container(digital, "Customer Profile Service", "Preferences, payees and notification settings.", "Kotlin");
  const profileDb = b.container(digital, "Profile DB", "Payees, preferences and device bindings.", "PostgreSQL", { kind: "Database", data: "confidential" });
  const events = b.container(digital, "Event Stream", "Account and payment events for the apps and fraud.", "Kafka", { kind: "Queue" });

  // --- dependencies ---
  b.rel("c4:Uses", customer, app, "Banks with", "HTTPS");
  b.rel("c4:Uses", customer, web, "Banks with", "HTTPS");
  b.rel("c4:Uses", app, bff, "Calls", "JSON/HTTPS");
  b.rel("c4:Uses", web, bff, "Calls", "JSON/HTTPS");
  b.rel("c4:Uses", bff, iam, "Authenticates customers with", "OIDC");
  b.rel("c4:Uses", bff, profile, "Reads payees from", "gRPC");
  b.rel("c4:Uses", profile, profileDb, "Stores data in", "SQL");
  b.rel("c4:Uses", bff, core, "Reads balances and transactions from", "MQ");
  b.rel("c4:Uses", bff, cloudCore, "Reads migrated accounts from", "gRPC");
  b.rel("c4:Uses", bff, payments, "Sends payments to", "ISO 20022 (pain.001)");
  b.rel("c4:Uses", bff, cards, "Freezes and replaces cards via", "REST");
  b.rel("c4:Uses", payments, fraud, "Asks for a score from", "gRPC");
  b.rel("c4:Uses", payments, core, "Posts to the ledger in", "MQ");
  b.rel("c4:Uses", payments, events, "Publishes PaymentSettled to", "Kafka");
  b.rel("c4:Uses", cards, fraud, "Sends authorisations for scoring to", "ISO 8583");
  b.rel("c4:Uses", fraud, events, "Publishes alerts to", "Kafka");
  b.rel("c4:Uses", analyst, fraud, "Reviews alerts in");
  b.rel("c4:Uses", tpp, openBanking, "Reads accounts and starts payments through", "PSD2 / Berlin Group");
  b.rel("c4:Uses", openBanking, iam, "Checks consent with", "OAuth 2.0");
  b.rel("c4:Uses", openBanking, bff, "Calls", "JSON/HTTPS");
  b.rel("c4:Uses", advisor, crm, "Records conversations in");
  b.rel("c4:Uses", advisor, lending, "Takes loan applications in");
  b.rel("c4:Uses", lending, aml, "Verifies identity with", "REST");
  b.rel("c4:Uses", lending, core, "Opens loan accounts in", "MQ");
  b.rel("c4:Uses", bff, aml, "Verifies new customers with", "REST");
  b.rel("c4:Uses", crm, core, "Reads customer accounts from", "MQ");
  b.rel("c4:Uses", dwh, core, "Extracts the ledger nightly from", "Batch file");
  b.rel("c4:Uses", dwh, payments, "Extracts payments from", "Batch file");
  b.rel("c4:Uses", dwh, regulator, "Submits returns to", "XBRL");

  // --- ArchiMate: capabilities, value stream, motivation and a process ---
  const custMgmt = b.capability("Customer Management", "Know and look after customers.", undefined, "Adequate");
  const onboarding = b.capability("Customer Onboarding", "Open a relationship with a new customer.", custMgmt, "Insufficient", 420000);
  const kyc = b.capability("Know Your Customer", "Verify identity and screen against sanctions and PEP lists.", custMgmt, "Adequate", 380000);
  const accounts = b.capability("Accounts & Deposits", "Hold money and pay interest.", undefined, "Adequate");
  const accountMgmt = b.capability("Account Management", "Open, run and close accounts.", accounts, "Insufficient", 6200000);
  const lendingCap = b.capability("Lending", "Lend money and get it back.", undefined, "Insufficient");
  const origination = b.capability("Loan Origination", "Assess and approve loan applications.", lendingCap, "Insufficient", 700000);
  const servicing = b.capability("Loan Servicing", "Collect repayments and handle arrears.", lendingCap, "Adequate", 300000);
  const paymentsCap = b.capability("Payments", "Move money for customers.", undefined, "Excellent");
  const instant = b.capability("Instant Payments", "Domestic and SEPA instant credit transfers.", paymentsCap, "Excellent", 950000);
  const cardPay = b.capability("Card Payments", "Debit card issuing and authorisation.", paymentsCap, "Excellent", 1200000);
  const risk = b.capability("Risk & Compliance", "Stay within the law and the bank's risk appetite.", undefined, "Adequate");
  const fraudCap = b.capability("Fraud Prevention", "Stop fraudulent payments before money leaves.", risk, "Excellent", 640000);
  const reporting = b.capability("Regulatory Reporting", "Produce returns for the regulator on time.", risk, "Insufficient", 610000);
  for (const [s, c] of [[digital, onboarding], [aml, kyc], [core, accountMgmt], [cloudCore, accountMgmt], [lending, origination], [core, servicing], [payments, instant], [cards, cardPay], [fraud, fraudCap], [dwh, reporting], [crm, custMgmt]] as const) b.rel("archimate:Realization", s, c);

  const psd2 = b.el("archimate:Driver", "PSD2 and open banking", "Regulation that requires account access for licensed third parties and strong customer authentication.");
  const pci = b.el("archimate:Driver", "PCI DSS", "Card industry security standard; scope grows with every system that touches card numbers.");
  const goalDigital = b.el("archimate:Goal", "Open an account in under 10 minutes", "Customers finish onboarding on their phone without visiting a branch.");
  const reqSca = b.el("archimate:Requirement", "Strong customer authentication", "Two independent factors for logins and payments.");
  const reqTokens = b.el("archimate:Requirement", "No card numbers in our systems", "Only the card processor stores primary account numbers; the bank keeps tokens.");
  b.rel("archimate:Influence", psd2, reqSca);
  b.rel("archimate:Influence", pci, reqTokens);
  b.rel("archimate:Realization", iam, reqSca);
  b.rel("archimate:Realization", cards, reqTokens);
  b.rel("archimate:Realization", digital, goalDigital);

  const apply = b.el("archimate:Process", "Apply online", "The customer enters details and documents in the app.");
  const verify = b.el("archimate:Process", "Verify identity", "Document and selfie check by the KYC vendor.");
  const screen = b.el("archimate:Process", "Screen sanctions and PEP", "Automated screening, with manual review of matches.");
  const open = b.el("archimate:Process", "Open account", "Create the account in the core and send details.");
  const issue = b.el("archimate:Process", "Issue debit card", "Order a card and add it to the wallet.");
  b.chain("archimate:Triggering", apply, verify, screen, open, issue);
  b.rel("archimate:Serving", digital, apply);
  b.rel("archimate:Serving", aml, verify);
  b.rel("archimate:Serving", aml, screen);
  b.rel("archimate:Serving", cloudCore, open);
  b.rel("archimate:Serving", cards, issue);

  // --- DDD ---
  const domain = b.el("ddd:Domain", "Retail Banking", "Accounts, payments, cards and loans for individuals.");
  const sdPayments = b.el("ddd:Subdomain", "Payments (subdomain)", "Fast, safe money movement: where the bank competes.", { parent: domain.id, properties: { subdomainType: "Core" } });
  const sdLending = b.el("ddd:Subdomain", "Lending (subdomain)", "Credit decisions and loan accounts.", { parent: domain.id, properties: { subdomainType: "Core" } });
  b.el("ddd:Subdomain", "Onboarding (subdomain)", "Getting customers through KYC.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  b.el("ddd:Subdomain", "Identity (subdomain)", "Logins and authentication; bought, not built.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  const teamPay = b.el("ddd:Team", "Team Payments", "Owns the Payments Hub.");
  const teamDigital = b.el("ddd:Team", "Team Digital", "Owns the apps and the Banking API.");
  b.rel("ddd:Implements", payments, sdPayments);
  b.rel("ddd:Implements", lending, sdLending);
  b.rel("ddd:Owns", teamPay, payments);
  b.rel("ddd:Owns", teamDigital, digital);
  b.rel("ddd:Partnership", digital, payments, "payment journeys");
  b.rel("ddd:AnticorruptionLayer", core, digital, "accounts from the mainframe").properties.downstreamRoles = "ACL";
  b.rel("ddd:OpenHostService", openBanking, digital, "PSD2 APIs");
  b.rel("ddd:CustomerSupplier", payments, fraud, "payments to score");
  b.rel("ddd:Conformist", cards, digital, "card processor's model");

  const st = (type: string, name: string, description: string) => b.el(type, name, description, { parent: payments.id });
  const cInit = st("ddd:Command", "Send payment", "A customer pays someone from the app.");
  const aPay = st("ddd:Aggregate", "Payment", "Keeps a payment's state and limits consistent.");
  const eInit = st("ddd:DomainEvent", "Payment initiated", "The payment passed limits and validation.");
  const pScore = st("ddd:Policy", "Score every payment", "Whenever a payment is initiated, ask the fraud engine.");
  const eCleared = st("ddd:DomainEvent", "Payment cleared", "The fraud score is below the threshold.");
  const pSettle = st("ddd:Policy", "Settle when cleared", "Whenever a payment clears, send it to the scheme.");
  const cSettle = st("ddd:Command", "Settle payment", "Send pacs.008 to the instant payment scheme.");
  const eSettled = st("ddd:DomainEvent", "Payment settled", "The scheme confirmed the transfer.");
  const rBalance = st("ddd:ReadModel", "Available balance", "What the customer sees in the app.");
  b.chain("ddd:Triggers", cInit, aPay, eInit, pScore, eCleared, pSettle, cSettle, eSettled, rBalance);

  // --- TOGAF ---
  const abbPay = b.el("togaf:ArchitectureBuildingBlock", "Real-time payments", "Send and receive payments in seconds, every day of the year.", { properties: { admPhase: "B: Business Architecture" } });
  const sbbPay = b.el("togaf:SolutionBuildingBlock", "ISO 20022 Payments Hub", "The bank's own hub, connected to the instant payment scheme.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  const abbKyc = b.el("togaf:ArchitectureBuildingBlock", "Remote identity verification", "Verify a new customer without a branch visit.", { properties: { admPhase: "B: Business Architecture" } });
  const sbbKyc = b.el("togaf:SolutionBuildingBlock", "Vendor eKYC service", "Document and liveness checks from a specialist vendor.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  b.rel("togaf:Realizes", sbbPay, abbPay);
  b.rel("togaf:Realizes", sbbKyc, abbKyc);
  b.rel("togaf:Uses", sbbPay, payments);
  b.rel("togaf:Uses", sbbKyc, aml);

  // --- views ---
  const app_ = { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" };
  b.rows("c4", "c4:landscape", "Bank landscape", [[customer, advisor, analyst, tpp], [digital, openBanking, lending, crm], [payments, fraud, iam, dwh], [core, cloudCore, cards, aml, regulator]], { properties: app_ });
  b.rows("c4", "c4:context", "Digital Banking – context", [[customer, tpp], [openBanking, digital, iam], [core, cloudCore, payments, cards, aml]], { subject: digital.id });
  b.rows("c4", "c4:container", "Digital Banking – containers", [[customer], [group(digital, [app, web], [bff, profile, profileDb], [events])], [iam, core, cloudCore, payments, cards, aml]], { subject: digital.id, properties: app_ });
  b.rows("c4", "c4:context", "Payments Hub – context", [[digital], [payments], [fraud, core], [analyst, dwh]], { subject: payments.id });
  b.rows("archimate", "archimate:capability-map", "Capability map", [[group(custMgmt, [onboarding, kyc]), group(accounts, [accountMgmt]), group(lendingCap, [origination, servicing])], [group(paymentsCap, [instant, cardPay]), group(risk, [fraudCap, reporting])]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  b.rows("archimate", "archimate:business-process-cooperation", "Account opening", [[apply, verify, screen, open, issue], [digital, aml, cloudCore, cards]], { properties: { architectureDomain: "Business" } });
  b.rows("archimate", "archimate:motivation", "Regulation and goals", [[psd2, pci], [goalDigital, reqSca, reqTokens]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:requirements-realization", "How requirements are met", [[goalDigital, reqSca, reqTokens], [digital, iam, cards]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:application", "Application cooperation", [[digital, openBanking, lending], [payments, fraud, crm], [core, cloudCore, cards, aml]], { properties: { ...app_, alsoShow: "c4" } });
  b.rows("ddd", "ddd:context-map", "Context map", [[teamDigital, teamPay], [openBanking, digital, payments], [core, cards, fraud]], { properties: { architectureDomain: "Business" } });
  b.rows("ddd", "ddd:event-storming", "Send a payment (event storm)", [[cInit, aPay, eInit, pScore, eCleared], [pSettle, cSettle, eSettled, rBalance]]);
  b.canvas("Payments Hub – Bounded Context Canvas", payments);
  b.rows("togaf", "togaf:building-blocks", "Building blocks", [[abbPay, abbKyc], [sbbPay, sbbKyc], [payments, aml]], { properties: { admPhase: "E: Opportunities and Solutions" } });

  // --- decisions, rules, filters ---
  b.adr("0001", "Use ISO 20022 for all new payment flows", "accepted", "2022-03-10", [payments, bff], "## Context\n\nDomestic schemes and SEPA are moving to ISO 20022. Our old formats needed a translation for every new scheme.\n\n## Decision\n\nThe Payments Hub speaks ISO 20022 natively (pain, pacs, camt). Channels send pain.001.\n\n## Consequences\n\nRicher remittance data reaches customers and fraud scoring. Legacy batch formats are converted at the edge only.");
  b.adr("0002", "Strangle the mainframe core product by product", "accepted", "2025-01-15", [core, cloudCore, bff], "## Context\n\nThe mainframe is expensive, hard to staff and leaves support at the end of 2028.\n\n## Decision\n\nMove products to the Cloud Core one at a time, savings first, behind the Banking API, which reads from whichever core holds the account.\n\n## Consequences\n\nBoth cores run in parallel until 2028. Regulatory Reporting must read from both during the migration.");
  b.adr("0003", "Keep card numbers out of the bank's systems", "accepted", "2021-06-01", [cards, bff], "## Context\n\nEvery system that stores card numbers is in PCI DSS scope.\n\n## Decision\n\nThe card processor holds card numbers. The bank stores only tokens and the last four digits.\n\n## Consequences\n\nPCI scope shrinks to the integration. Card display in the app uses the processor's secure view.");
  b.ws.rules = [
    { id: "systems-have-owners", description: "Every system has an accountable owner.", severity: "warning", match: { type: "c4:SoftwareSystem" }, require: ["owner", "lifecycle"] },
    { id: "restricted-data-stays-inside", description: "Restricted data is not sent to external systems without a decision record.", severity: "warning", forbid: { from: { property: { dataClassification: "restricted" } }, to: { tag: "external" }, type: "c4:Uses" } },
  ];
  b.ws.savedFilters = [{ name: "Phasing out", query: "phase:phaseout", types: [] }, { name: "External", query: "tag:external", types: [] }];
  return b.ws;
}
