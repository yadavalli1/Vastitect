import type { ComponentType, ReactNode } from "react";
import type { Id } from "@vastitecture/core";

/** Seams where feature modules plug UI into the shell without the shell knowing about them. */
export const extensions: {
  toolbar: ComponentType[];
  codePane?: ComponentType<{ viewId: Id }>;
  /** Return a custom renderer for board/form views, or undefined to use the node canvas. */
  viewRenderers: ((viewId: Id) => ReactNode | undefined)[];
  viewRenderer(viewId: Id): ReactNode | undefined;
} = {
  toolbar: [],
  viewRenderers: [],
  viewRenderer(viewId) {
    for (const r of this.viewRenderers) {
      const out = r(viewId);
      if (out) return out;
    }
    return undefined;
  },
};
