import type { Workspace } from "@vastitecture/core";
import { SampleBuilder, group } from "./builder";

/**
 * Healthcare: a hospital group with an electronic health record at its centre, HL7 v2 and FHIR
 * integration, imaging, labs, a patient app and a move from on-premise integration to a FHIR platform.
 * All names are fictional.
 */
export function buildHealthcare(): Workspace {
  const b = new SampleBuilder("Sample: Riverside Health (hospital group)");

  const patient = b.person("Patient", "Books appointments, sees results and messages the care team.");
  const clinician = b.person("Clinician", "Doctors and nurses who record and review care.");
  const scheduler = b.person("Scheduler", "Books clinics, theatres and beds.");
  const gp = b.person("Family Doctor", "Refers patients and receives discharge summaries.");

  const ehr = b.system("Electronic Health Record", "Patient record, orders, results, medication and clinical notes.", {
    owner: "Clinical Systems", tags: ["tier-1", "system-of-record"], phase: "active", dates: { active: "2018-10-01" },
    criticality: "Mission critical", technicalFit: "Adequate", functionalFit: "Excellent", annualCost: 4200000, monthlyCost: 350000, data: "restricted",
    props: { domainClassification: "Core", businessModel: "Compliance", evolution: "Product", purpose: "One record of a patient's care across every site.", ubiquitousLanguage: "Encounter: one contact between a patient and the hospital.\nOrder: a request for a test, medicine or procedure.\nResult: the outcome of an order." },
  });
  const pas = b.system("Patient Administration", "Registration, admissions, transfers, discharges and clinic booking.", {
    owner: "Clinical Systems", tags: ["system-of-record"], phase: "active", criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 900000, monthlyCost: 75000, data: "restricted",
  });
  const lis = b.system("Laboratory System", "Specimens, analysers and lab results.", { owner: "Pathology", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 620000, monthlyCost: 52000, data: "restricted" });
  const pacs = b.system("Imaging (PACS)", "Stores and shows X-ray, CT and MRI images.", { owner: "Radiology", phase: "active", criticality: "Mission critical", technicalFit: "Adequate", annualCost: 780000, monthlyCost: 65000, data: "restricted" });
  const pharmacy = b.system("Pharmacy System", "Dispensing and stock for inpatient medicines.", { owner: "Pharmacy", phase: "active", criticality: "Business critical", technicalFit: "Insufficient", annualCost: 210000, monthlyCost: 18000, data: "restricted" });
  const engine = b.system("Integration Engine", "On-premise HL7 v2 interface engine that routes messages between clinical systems.", {
    owner: "Integration", tags: ["legacy"], phase: "phaseOut", dates: { active: "2009-03-01", phaseOut: "2026-04-01", endOfLife: "2027-09-30" },
    criticality: "Mission critical", technicalFit: "Insufficient", functionalFit: "Adequate", annualCost: 340000, monthlyCost: 28000, data: "restricted", admPhase: "F: Migration Planning",
  });
  const fhir = b.system("FHIR Platform", "Managed FHIR R4 server and API gateway for internal and partner access.", {
    owner: "Integration", phase: "phaseIn", dates: { plan: "2025-02-01", phaseIn: "2025-11-01", active: "2026-10-01" },
    criticality: "Mission critical", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 480000, monthlyCost: 40000, data: "restricted", admPhase: "E: Opportunities and Solutions",
  });
  const patientApp = b.system("Patient App", "Appointments, letters, results and secure messaging.", {
    owner: "Digital", tags: ["customer-facing"], phase: "active", dates: { active: "2023-04-01" }, criticality: "Business operational", technicalFit: "Excellent", functionalFit: "Adequate", annualCost: 260000, monthlyCost: 22000, data: "restricted",
  });
  const hie = b.system("Regional Health Exchange", "Shares summaries with family doctors and other hospitals.", { owner: "Partnerships", external: true, phase: "active", criticality: "Business critical", data: "restricted" });
  const nationalId = b.system("National Patient Index", "National patient identifiers and demographics.", { external: true, phase: "active", criticality: "Business critical", data: "confidential" });
  const analytics = b.system("Clinical Analytics", "De-identified data for quality, research and capacity planning.", { owner: "Information", phase: "active", criticality: "Administrative", technicalFit: "Adequate", annualCost: 300000, monthlyCost: 25000, data: "confidential" });
  const billing = b.system("Revenue Cycle", "Coding, charge capture and claims to payers.", { owner: "Finance", phase: "active", criticality: "Business critical", technicalFit: "Adequate", annualCost: 520000, monthlyCost: 43000, data: "restricted" });
  const payer = b.system("Payers", "Insurers and public funders that reimburse care.", { owner: "Finance", external: true, phase: "active", data: "restricted" });

  const ehrWeb = b.container(ehr, "Clinician Workspace", "Charting, orders and results review.", "Web client");
  const orders = b.container(ehr, "Orders Service", "Places and tracks orders for labs, imaging and medicines.", "Vendor module");
  const cds = b.container(ehr, "Clinical Decision Support", "Alerts for allergies, interactions and sepsis.", "Rules engine");
  const ehrDb = b.container(ehr, "Clinical Data Repository", "The patient record.", "Vendor database", { kind: "Database", data: "restricted" });
  const fhirApi = b.container(ehr, "FHIR API", "SMART on FHIR access to the record.", "FHIR R4");

  b.rel("c4:Uses", clinician, ehrWeb, "Records and reviews care in", "HTTPS");
  b.rel("c4:Uses", ehrWeb, orders, "Places orders with");
  b.rel("c4:Uses", ehrWeb, cds, "Is checked by");
  b.rel("c4:Uses", orders, ehrDb, "Stores orders in");
  b.rel("c4:Uses", fhirApi, ehrDb, "Reads and writes the record in");
  b.rel("c4:Uses", scheduler, pas, "Books appointments in");
  b.rel("c4:Uses", pas, engine, "Sends admissions and transfers (ADT) to", "HL7 v2");
  b.rel("c4:Uses", engine, ehr, "Delivers ADT, results and reports to", "HL7 v2");
  b.rel("c4:Uses", orders, engine, "Sends lab and imaging orders to", "HL7 v2 ORM");
  b.rel("c4:Uses", engine, lis, "Routes lab orders to", "HL7 v2");
  b.rel("c4:Uses", engine, pacs, "Routes imaging orders to", "HL7 v2");
  b.rel("c4:Uses", lis, engine, "Returns results to", "HL7 v2 ORU");
  b.rel("c4:Uses", clinician, pacs, "Views images in", "DICOM");
  b.rel("c4:Uses", orders, pharmacy, "Sends medicine orders to", "HL7 v2");
  b.rel("c4:Uses", patient, patientApp, "Manages appointments and results in", "HTTPS");
  b.rel("c4:Uses", patientApp, fhir, "Reads appointments and results from", "FHIR R4");
  b.rel("c4:Uses", fhir, fhirApi, "Reads the record through", "FHIR R4");
  b.rel("c4:Uses", fhir, pas, "Reads appointments from", "FHIR R4");
  b.rel("c4:Uses", fhir, hie, "Shares discharge summaries with", "FHIR R4");
  b.rel("c4:Uses", gp, hie, "Receives summaries from");
  b.rel("c4:Uses", pas, nationalId, "Looks up patient identifiers in", "FHIR R4");
  b.rel("c4:Uses", analytics, ehr, "Extracts de-identified data from", "Batch", { dataFlow: "none" });
  b.rel("c4:Uses", billing, ehr, "Captures charges from", "HL7 v2 DFT");
  b.rel("c4:Uses", billing, payer, "Sends claims to", "EDI 837");

  // ArchiMate
  const access = b.capability("Patient Access", "Get patients the right appointment.", undefined, "Adequate");
  const registration = b.capability("Registration", "Identify and register patients.", access, "Adequate", 300000);
  const scheduling = b.capability("Scheduling", "Book clinics, theatres and beds.", access, "Insufficient", 600000);
  const care = b.capability("Clinical Care", "Diagnose and treat patients.", undefined, "Excellent");
  const documentation = b.capability("Clinical Documentation", "Record care.", care, "Excellent", 2000000);
  const ordersCap = b.capability("Orders & Results", "Request tests and act on results.", care, "Adequate", 1200000);
  const medicines = b.capability("Medicines Management", "Prescribe, dispense and administer.", care, "Insufficient", 400000);
  const diagnostics = b.capability("Diagnostics", "Run tests and imaging.", undefined, "Adequate");
  const lab = b.capability("Laboratory Services", "Analyse specimens.", diagnostics, "Adequate", 620000);
  const imaging = b.capability("Imaging Services", "Acquire and report images.", diagnostics, "Adequate", 780000);
  const coordination = b.capability("Care Coordination", "Share care across organisations.", undefined, "Insufficient");
  const sharing = b.capability("Record Sharing", "Share records with other providers.", coordination, "Insufficient", 340000);
  const engagement = b.capability("Patient Engagement", "Let patients take part in their care.", coordination, "Adequate", 260000);
  const revenue = b.capability("Revenue Cycle", "Get paid for care.", undefined, "Adequate", 520000);
  for (const [s, c] of [[pas, registration], [pas, scheduling], [ehr, documentation], [orders, ordersCap], [pharmacy, medicines], [lis, lab], [pacs, imaging], [engine, sharing], [fhir, sharing], [patientApp, engagement], [billing, revenue]] as const) b.rel("archimate:Realization", s, c);

  const hipaa = b.el("archimate:Driver", "Patient privacy law", "Health data may only be shared for care, with consent or by law (HIPAA, GDPR).");
  const interop = b.el("archimate:Driver", "Interoperability mandates", "Regulators require patient access and record sharing through FHIR APIs.");
  const goalShare = b.el("archimate:Goal", "Share records within an hour of discharge", "Family doctors see the discharge summary the same day.");
  const reqAudit = b.el("archimate:Requirement", "Audit every record access", "Every view of a patient record is logged and reviewable.");
  const reqFhir = b.el("archimate:Requirement", "Patient access through FHIR", "Patients and their apps can read their record through standard APIs.");
  b.rel("archimate:Influence", hipaa, reqAudit);
  b.rel("archimate:Influence", interop, reqFhir);
  b.rel("archimate:Influence", interop, goalShare);
  b.rel("archimate:Realization", ehr, reqAudit);
  b.rel("archimate:Realization", fhir, reqFhir);
  b.rel("archimate:Realization", fhir, goalShare);

  const refer = b.el("archimate:Process", "Receive referral", "The family doctor refers the patient.");
  const book = b.el("archimate:Process", "Book first appointment", "Triage the referral and offer a slot.");
  const consult = b.el("archimate:Process", "Outpatient consultation", "Assess and order tests.");
  const test = b.el("archimate:Process", "Diagnostic tests", "Lab and imaging.");
  const plan = b.el("archimate:Process", "Agree treatment plan", "Share the plan with the patient and family doctor.");
  b.chain("archimate:Triggering", refer, book, consult, test, plan);
  b.rel("archimate:Serving", pas, book);
  b.rel("archimate:Serving", ehr, consult);
  b.rel("archimate:Serving", lis, test);
  b.rel("archimate:Serving", pacs, test);
  b.rel("archimate:Serving", fhir, plan);

  // DDD
  const domain = b.el("ddd:Domain", "Acute Care", "Hospital care from referral to discharge.");
  const sdClin = b.el("ddd:Subdomain", "Clinical Record (subdomain)", "What happened to the patient and why.", { parent: domain.id, properties: { subdomainType: "Core" } });
  const sdSched = b.el("ddd:Subdomain", "Scheduling (subdomain)", "Capacity is the hospital's constraint.", { parent: domain.id, properties: { subdomainType: "Core" } });
  b.el("ddd:Subdomain", "Billing (subdomain)", "Coding and claims.", { parent: domain.id, properties: { subdomainType: "Supporting" } });
  b.el("ddd:Subdomain", "Identity (subdomain)", "Who the patient is; from the national index.", { parent: domain.id, properties: { subdomainType: "Generic" } });
  const teamClin = b.el("ddd:Team", "Clinical Systems", "Runs the EHR and patient administration.");
  const teamInt = b.el("ddd:Team", "Integration", "Runs the integration engine and FHIR platform.");
  b.rel("ddd:Implements", ehr, sdClin);
  b.rel("ddd:Implements", pas, sdSched);
  b.rel("ddd:Owns", teamClin, ehr);
  b.rel("ddd:Owns", teamInt, fhir);
  b.rel("ddd:PublishedLanguage", fhir, hie, "FHIR R4");
  b.rel("ddd:OpenHostService", fhir, patientApp, "FHIR APIs");
  b.rel("ddd:CustomerSupplier", pas, ehr, "patient movements (ADT)");
  b.rel("ddd:Conformist", lis, ehr, "the EHR's order model");
  b.rel("ddd:Conformist", pas, nationalId, "national identifiers");

  const st = (type: string, name: string, description: string) => b.el(type, name, description, { parent: ehr.id });
  const cOrder = st("ddd:Command", "Order blood test", "A clinician orders a full blood count.");
  const aOrder = st("ddd:Aggregate", "Order (aggregate)", "Tracks an order from request to result.");
  const ePlaced = st("ddd:DomainEvent", "Order placed", "The lab can collect the specimen.");
  const eResulted = st("ddd:DomainEvent", "Result available", "The lab released the result.");
  const pAbnormal = st("ddd:Policy", "Alert on critical results", "Whenever a result is critical, page the responsible clinician.");
  const cAck = st("ddd:Command", "Acknowledge result", "The clinician confirms they have seen it.");
  const eAck = st("ddd:DomainEvent", "Result acknowledged", "Responsibility for acting on the result is recorded.");
  const rInbox = st("ddd:ReadModel", "Results inbox", "Results waiting for each clinician.");
  b.chain("ddd:Triggers", cOrder, aOrder, ePlaced, eResulted, pAbnormal, cAck, eAck);
  b.rel("ddd:Triggers", eResulted, rInbox);

  // TOGAF
  const abb = b.el("togaf:ArchitectureBuildingBlock", "Standards-based record sharing", "Share clinical data with any partner through open standards.", { properties: { admPhase: "B: Business Architecture" } });
  const sbb = b.el("togaf:SolutionBuildingBlock", "Managed FHIR platform", "FHIR R4 server, consent and API gateway as a managed service.", { properties: { admPhase: "E: Opportunities and Solutions" } });
  b.rel("togaf:Realizes", sbb, abb);
  b.rel("togaf:Uses", sbb, fhir);

  // views
  const app_ = { admPhase: "C: Information Systems Architectures", architectureDomain: "Application" };
  b.rows("c4", "c4:landscape", "Hospital landscape", [[patient, clinician, scheduler, gp], [patientApp, ehr, pas, billing], [engine, fhir, lis, pacs, pharmacy], [hie, nationalId, payer, analytics]], { properties: app_ });
  b.rows("c4", "c4:container", "EHR – containers", [[clinician], [group(ehr, [ehrWeb, orders, cds], [fhirApi, ehrDb])], [engine, fhir, pharmacy, billing, analytics]], { subject: ehr.id, properties: app_ });
  b.rows("c4", "c4:context", "FHIR Platform – context", [[patient, gp], [patientApp, hie], [fhir], [ehr, pas]], { subject: fhir.id });
  b.rows("archimate", "archimate:capability-map", "Capability map", [[group(access, [registration, scheduling]), group(care, [documentation, ordersCap, medicines])], [group(diagnostics, [lab, imaging]), group(coordination, [sharing, engagement]), revenue]], { properties: { admPhase: "B: Business Architecture", architectureDomain: "Business" } });
  b.rows("archimate", "archimate:business-process-cooperation", "Referral to treatment", [[refer, book, consult, test, plan], [pas, ehr, lis, pacs, fhir]], { properties: { architectureDomain: "Business" } });
  b.rows("archimate", "archimate:motivation", "Privacy and interoperability", [[hipaa, interop], [reqAudit, reqFhir, goalShare]], { properties: { admPhase: "Requirements Management" } });
  b.rows("archimate", "archimate:requirements-realization", "How requirements are met", [[reqAudit, reqFhir, goalShare], [ehr, fhir]], { properties: { admPhase: "Requirements Management" } });
  b.rows("ddd", "ddd:context-map", "Context map", [[teamClin, teamInt], [pas, ehr, fhir, patientApp], [nationalId, lis, hie]], { properties: { architectureDomain: "Business" } });
  b.rows("ddd", "ddd:event-storming", "Order to acknowledged result (event storm)", [[cOrder, aOrder, ePlaced, eResulted], [pAbnormal, cAck, eAck, rInbox]]);
  b.canvas("EHR – Bounded Context Canvas", ehr);
  b.rows("togaf", "togaf:building-blocks", "Record sharing building blocks", [[abb], [sbb], [fhir]], { properties: { admPhase: "E: Opportunities and Solutions" } });

  b.adr("0001", "Move from point-to-point HL7 v2 to a FHIR platform", "accepted", "2025-02-01", [engine, fhir], "## Context\n\nThe interface engine runs more than 300 HL7 v2 feeds, leaves support in 2027 and cannot serve patient apps or partners.\n\n## Decision\n\nNew integrations use the FHIR platform. HL7 v2 feeds move across as their source systems are upgraded.\n\n## Consequences\n\nBoth run until the last feed moves. Partners get one API with consent checks.");
  b.adr("0002", "De-identify data before it reaches analytics", "accepted", "2023-08-15", [analytics, ehr], "## Context\n\nQuality and research teams need data at scale, but not identities.\n\n## Decision\n\nThe extract removes direct identifiers and shifts dates; re-identification keys stay with Information Governance.\n\n## Consequences\n\nThe analytics platform is cleared for confidential, not restricted, data.");
  b.ws.rules = [
    { id: "clinical-systems-have-owners", description: "Every system holding patient data has an owner.", severity: "error", match: { type: "c4:SoftwareSystem", property: { dataClassification: "restricted" } }, require: ["owner"] },
    { id: "new-feeds-use-fhir", description: "New systems integrate through the FHIR platform, not the legacy engine.", severity: "warning", forbid: { from: { lifecycle: ["plan", "phaseIn"] }, to: { tag: "legacy" } } },
  ];
  b.ws.savedFilters = [{ name: "Systems", query: "", types: ["c4:SoftwareSystem"] }, { name: "External", query: "tag:external", types: [] }];
  return b.ws;
}
