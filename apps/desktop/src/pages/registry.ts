import type { ReactNode } from "react";
import type { Page } from "../state";

export interface PageDef {
  id: Page;
  label(): string;
  icon: string;
  render(): ReactNode;
}
/** Feature pages register here; the rail and the command palette are built from this list. */
export const pages: PageDef[] = [];
