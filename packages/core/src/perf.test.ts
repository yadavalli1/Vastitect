import { describe, expect, it } from "vitest";
import { ModelStore, fromFiles, toFiles, validate, Registry } from "./index";
import { bigWorkspace } from "./generate";

describe("performance budget", () => {
  it("parses a 5,000-element, 200-view workspace from its files well under 2 seconds", () => {
    const { files } = toFiles(bigWorkspace());
    expect(Object.keys(files).length).toBe(5000 + 200 + 2);
    const t0 = performance.now();
    const { workspace, issues } = fromFiles(files);
    const ms = performance.now() - t0;
    console.log(`fromFiles: ${ms.toFixed(0)} ms for ${Object.keys(files).length} files`);
    expect(issues).toEqual([]);
    expect(Object.keys(workspace.elements)).toHaveLength(5000);
    expect(ms).toBeLessThan(2000);
  });

  it("applies an edit and validates the big workspace quickly", () => {
    const store = new ModelStore(bigWorkspace());
    const id = Object.keys(store.state.elements)[42];
    const t0 = performance.now();
    store.dispatch({ type: "updateElement", id, patch: { name: "Renamed" } });
    const first = performance.now() - t0;
    const t2 = performance.now();
    store.dispatch({ type: "updateElement", id, patch: { name: "Renamed again" } });
    const edit = performance.now() - t2;
    const t1 = performance.now();
    validate(store.state, new Registry());
    const val = performance.now() - t1;
    console.log(`first edit: ${first.toFixed(1)} ms, next edit: ${edit.toFixed(1)} ms, validate: ${val.toFixed(0)} ms`);
    expect(first).toBeLessThan(200);
    expect(edit).toBeLessThan(16);
    expect(val).toBeLessThan(1500);
  });
});
