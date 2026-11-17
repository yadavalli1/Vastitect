import { describe, expect, it } from "vitest";
import { Registry, emptyWorkspace, makeElement, makeRelationship, makeView } from "@vastitecture/core";
import { markdownToHtml } from "./markdown";
import { viewToSvg } from "./svg";

describe("markdown", () => {
  it("renders the common subset and escapes HTML", () => {
    const html = markdownToHtml("# Title\n\nSome **bold** and `code` with a [link](https://example.com).\n\n- one\n- two\n\n```\n<script>x</script>\n```\n\n<img src=x onerror=alert(1)>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("<a");
  });
});

describe("svg export", () => {
  it("draws every node with an accessible label and every edge", () => {
    const reg = new Registry();
    reg.registerPack({ id: "x", name: "X", elementTypes: [{ id: "x:Box", name: "Box", shape: "rect" }], relationshipTypes: [{ id: "x:Uses", name: "Uses" }], viewpoints: [] });
    const ws = emptyWorkspace();
    const a = makeElement("x:Box", "A & B"), b = makeElement("x:Box", "C");
    const r = makeRelationship("x:Uses", a.id, b.id, { label: "calls <api>" });
    ws.elements[a.id] = a;
    ws.elements[b.id] = b;
    ws.relationships[r.id] = r;
    const v = makeView("x", "V", { nodes: [{ element: a.id, x: 0, y: 0, w: 100, h: 50 }, { element: b.id, x: 200, y: 0, w: 100, h: 50 }], edges: [{ relationship: r.id }] });
    const svg = viewToSvg(ws, v, reg);
    expect(svg).toContain('aria-label="Box: A &amp; B"');
    expect(svg).toContain("calls &lt;api&gt;");
    expect(svg.match(/<path d="M/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
