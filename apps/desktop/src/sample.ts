import { DEFAULT_MAPPINGS, emptyWorkspace, makeElement, makeRelationship, makeView, type Workspace } from "@vastitecture/core";
import { registry } from "./plugins";

/** First-launch workspace. Extended by later packs through `sampleBuilders`. */
export const sampleBuilders: ((ws: Workspace) => void)[] = [];

export function buildSample(): Workspace {
  const ws: Workspace = { ...emptyWorkspace("Sample: Online Shop", [...registry.packs.keys()]), mappings: DEFAULT_MAPPINGS };
  for (const b of sampleBuilders) b(ws);
  if (!Object.keys(ws.views).length) {
    const add = (type: string, name: string, description: string) => {
      const e = makeElement(type, name, { description });
      ws.elements[e.id] = e;
      return e;
    };
    const start = add("generic:StartEnd", "Order placed", "A customer submits their basket.");
    const pay = add("generic:Process", "Take payment", "Charge the customer's card.");
    const ok = add("generic:Decision", "Paid?", "Did the charge succeed?");
    const ship = add("generic:Process", "Ship order", "Pick, pack and dispatch.");
    const fail = add("generic:StartEnd", "Order cancelled", "Tell the customer the payment failed.");
    const rel = (a: string, b: string, label?: string) => {
      const r = makeRelationship("generic:Arrow", a, b, label ? { label } : {});
      ws.relationships[r.id] = r;
      return { relationship: r.id };
    };
    const v = makeView("generic", "Order flow", {
      viewpoint: "generic:flowchart",
      nodes: [
        { element: start.id, x: 200, y: 40, w: 140, h: 60 },
        { element: pay.id, x: 200, y: 150, w: 140, h: 70 },
        { element: ok.id, x: 205, y: 270, w: 130, h: 90 },
        { element: ship.id, x: 80, y: 420, w: 140, h: 70 },
        { element: fail.id, x: 320, y: 425, w: 140, h: 60 },
      ],
      edges: [rel(start.id, pay.id), rel(pay.id, ok.id), rel(ok.id, ship.id, "yes"), rel(ok.id, fail.id, "no")],
    });
    ws.views[v.id] = v;
  }
  return ws;
}
