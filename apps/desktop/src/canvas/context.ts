import { createContext } from "react";
import type { Id } from "@vastitecture/core";

/** Elements to keep lit when impact highlight or focus mode is on (null = everything). */
export const CanvasContext = createContext<{ highlight: Set<Id> | null; overlay?: Overlay }>({ highlight: null });

export type Tone = "add" | "change" | "remove" | "warn" | "info";
/** Colours and badges laid over the canvas by an analysis (model diff, plateaus, data exposure, costs). */
export interface Overlay {
  title: string;
  elements: Record<Id, { tone: Tone; badge?: string }>;
  relationships?: Record<Id, Tone>;
}
