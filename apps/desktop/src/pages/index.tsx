import { registry } from "../plugins";
import { extensions } from "../extensions";
import { model } from "../state";
import { FormView } from "../panels/FormView";
import { pages } from "./registry";
import { MappingsPage } from "./Mappings";
import { ReportsPage } from "./Reports";
import { RepositoryPage } from "./Repository";
import { PluginsPage } from "./Plugins";
import { t } from "../i18n";

pages.push(
  { id: "reports", label: () => t("Catalogs and matrices"), icon: "▦", render: () => <ReportsPage /> },
  { id: "repository", label: () => t("Architecture repository"), icon: "🗂", render: () => <RepositoryPage /> },
  { id: "mappings", label: () => t("Cross-notation mapping"), icon: "⇄", render: () => <MappingsPage /> },
  { id: "plugins", label: () => t("Plugins"), icon: "🧩", render: () => <PluginsPage /> },
);

// Views whose viewpoint is a form (e.g. the Bounded Context Canvas) are drawn as a card instead of a node canvas.
extensions.viewRenderers.push((viewId) => {
  const v = model.state.views[viewId];
  return v && registry.viewpoint(v.notation, v.viewpoint)?.kind === "form" ? <FormView key={viewId} viewId={viewId} /> : undefined;
});
