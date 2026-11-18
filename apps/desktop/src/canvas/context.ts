import { createContext } from "react";
import type { Id } from "@vastitecture/core";

/** Elements to keep lit when impact highlight or focus mode is on (null = everything). */
export const CanvasContext = createContext<{ highlight: Set<Id> | null }>({ highlight: null });
