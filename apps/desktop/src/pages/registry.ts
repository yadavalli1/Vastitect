import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Page } from "../state";

export interface PageDef {
  id: Page;
  label(): string;
  icon: LucideIcon;
  /** Navigation group: pages are shown in this order, separated by a rule. */
  group: "model" | "analyse" | "connect" | "app";
  render(): ReactNode;
}
/** Feature pages register here; the navigation rail and the command palette are built from this list. */
export const pages: PageDef[] = [];
