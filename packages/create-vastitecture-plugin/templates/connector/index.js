import { definePlugin, makeElement } from "@vastitecture/plugin-sdk";

// A read-only discovery connector. It runs only when the user presses Discover, may only contact
// the hosts listed in plugin.json, and returns a draft patch that the user reviews as a diff.
export default definePlugin({
  activate(ctx) {
    ctx.connectors.register({
      id: "__SLUG__",
      label: "__NAME__",
      description: "Lists services from https://catalog.example.com/api/services",
      fields: [{ key: "team", label: "Team (optional)", type: "string" }],
      async discover(input) {
        const token = await ctx.secrets.get("__SLUG__-token");
        const res = await ctx.net.fetch(`https://catalog.example.com/api/services${input.config.team ? `?team=${encodeURIComponent(input.config.team)}` : ""}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status !== 200) throw new Error(`Catalogue returned HTTP ${res.status}`);
        const services = JSON.parse(res.text);
        const elements = services.map((s) =>
          makeElement("c4:SoftwareSystem", s.name, { description: s.description, owner: s.team, properties: { externalId: `__SLUG__:${s.id}` } }),
        );
        return { elements, report: [`${elements.length} services found`] };
      },
    });
  },
});
