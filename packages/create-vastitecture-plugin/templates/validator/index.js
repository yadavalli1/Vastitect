import { definePlugin } from "@vastitecture/plugin-sdk";

// A house rule: every element tagged "tier-1" needs an owner. Quick fixes are model commands.
export default definePlugin({
  activate(ctx) {
    ctx.validators.register({
      id: "__SLUG__",
      run(ws) {
        return Object.values(ws.elements)
          .filter((e) => e.tags.includes("tier-1") && !e.owner)
          .map((e) => ({
            code: "__SLUG__/tier1-owner",
            severity: "warning",
            message: `"${e.name}" is tier-1 but has no owner`,
            target: { kind: "element", id: e.id },
            fixes: [{ label: "Assign to Platform", commands: [{ type: "updateElement", id: e.id, patch: { owner: "Platform" } }] }],
          }));
      },
    });
  },
});
