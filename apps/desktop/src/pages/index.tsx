import { registry } from "../plugins";
import { extensions } from "../extensions";
import { model } from "../state";
import { FormView } from "../panels/FormView";
import { pages } from "./registry";
import { MappingsPage } from "./Mappings";
import { ReportsPage } from "./Reports";
import { RepositoryPage } from "./Repository";
import { PluginsPage } from "./Plugins";
import { DiscoverPage } from "./Discover";
import { FactSheetsPage } from "./FactSheets";
import { CapabilitiesPage } from "./Capabilities";
import { RoadmapPage } from "./Roadmap";
import { ImpactPage } from "./Impact";
import { AdrsPage } from "./Adrs";
import { RulesPage } from "./Rules";
import { AssistantPage } from "./Assistant";
import { SettingsPage } from "./Settings";
import { t } from "../i18n";

pages.push(
  { id: "inventory", label: () => t("Fact sheets"), icon: "☰", render: () => <FactSheetsPage /> },
  { id: "capabilities", label: () => t("Capability map"), icon: "▤", render: () => <CapabilitiesPage /> },
  { id: "roadmap", label: () => t("Lifecycle roadmap"), icon: "⇶", render: () => <RoadmapPage /> },
  { id: "impact", label: () => t("Impact analysis"), icon: "⚡", render: () => <ImpactPage /> },
  { id: "rules", label: () => t("Architecture rules"), icon: "✓", render: () => <RulesPage /> },
  { id: "adrs", label: () => t("Decisions"), icon: "✎", render: () => <AdrsPage /> },
  { id: "reports", label: () => t("Catalogs and matrices"), icon: "▦", render: () => <ReportsPage /> },
  { id: "repository", label: () => t("Architecture repository"), icon: "🗂", render: () => <RepositoryPage /> },
  { id: "mappings", label: () => t("Cross-notation mapping"), icon: "⇄", render: () => <MappingsPage /> },
  { id: "discover", label: () => t("Discover"), icon: "🔍", render: () => <DiscoverPage /> },
  { id: "plugins", label: () => t("Plugins"), icon: "🧩", render: () => <PluginsPage /> },
  { id: "assistant", label: () => t("Assistant"), icon: "✦", render: () => <AssistantPage /> },
  { id: "settings", label: () => t("Settings"), icon: "⚙", render: () => <SettingsPage /> },
);

// Views whose viewpoint is a form (e.g. the Bounded Context Canvas) are drawn as a card instead of a node canvas.
extensions.viewRenderers.push((viewId) => {
  const v = model.state.views[viewId];
  return v && registry.viewpoint(v.notation, v.viewpoint)?.kind === "form" ? <FormView key={viewId} viewId={viewId} /> : undefined;
});
