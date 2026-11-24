import type { Workspace } from "@vastitecture/core";
import { buildBanking } from "./banking";
import { buildHealthcare } from "./healthcare";
import { buildInsurance } from "./insurance";
import { buildManufacturing } from "./manufacturing";
import { buildOnlineShop } from "./online-shop";
import { buildTelecom } from "./telecom";

export { SampleBuilder, group, type Cell, type Group, type Placed, type Portfolio } from "./builder";
export { buildBanking, buildHealthcare, buildInsurance, buildManufacturing, buildOnlineShop, buildTelecom };

export interface Sample {
  /** Stable id, used by `vastitecture new --sample <id>`. */
  id: string;
  industry: string;
  name: string;
  /** One sentence on what the sample shows. */
  description: string;
  build: () => Workspace;
}

/**
 * Sample workspaces, one per industry. Each one is modelled once and shown in C4, ArchiMate, DDD and
 * TOGAF, with portfolio data (owners, lifecycle dates, costs, fit, data classification), a migration
 * from a legacy system, regulations and goals, an event storm, decision records and architecture rules.
 * All organisations and people are fictional.
 */
export const SAMPLES: Sample[] = [
  { id: "retail", industry: "Retail", name: "Online Shop", description: "E-commerce checkout, payments and a warehouse system being replaced.", build: buildOnlineShop },
  { id: "banking", industry: "Banking", name: "Northbridge Bank", description: "Retail bank: digital channels, instant payments, open banking, fraud and a mainframe migration.", build: buildBanking },
  { id: "insurance", industry: "Insurance", name: "Harbour Mutual", description: "Property and casualty insurer: pricing, brokers, claims and a policy system replacement.", build: buildInsurance },
  { id: "healthcare", industry: "Healthcare", name: "Riverside Health", description: "Hospital group: EHR, labs, imaging, HL7 v2 to FHIR and patient privacy.", build: buildHealthcare },
  { id: "manufacturing", industry: "Manufacturing", name: "Atlas Pumps", description: "Discrete manufacturer: ERP, MES, PLM, ISA-95 plant network and predictive maintenance.", build: buildManufacturing },
  { id: "telecom", industry: "Telecommunications", name: "Meridian Telecom", description: "Mobile and broadband operator: TM Forum BSS/OSS, billing consolidation and network APIs.", build: buildTelecom },
];

export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id);
