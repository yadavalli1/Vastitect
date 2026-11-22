import { Suspense, lazy, type ComponentType } from "react";
import { ArrowLeftRight, ChartPie, GanttChart, LayoutGrid, Library, ListChecks, NotebookPen, Puzzle, Radar, Settings, Sheet, Sparkles, Table2, Zap } from "lucide-react";
import { registry } from "../plugins";
import { extensions } from "../extensions";
import { model } from "../state";
import { FormView } from "../panels/FormView";
import { pages } from "./registry";
import { t } from "../i18n";

/** Pages load when first opened, keeping start-up fast. */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => {
  const C: ComponentType = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return () => (
    <Suspense fallback={<div className="page muted">{t("Loading…")}</div>}>
      <C />
    </Suspense>
  );
};

pages.push(
  { id: "inventory", group: "model", icon: Table2, label: () => t("Fact sheets"), render: page(() => import("./FactSheets"), "FactSheetsPage") },
  { id: "capabilities", group: "model", icon: LayoutGrid, label: () => t("Capability map"), render: page(() => import("./Capabilities"), "CapabilitiesPage") },
  { id: "roadmap", group: "model", icon: GanttChart, label: () => t("Lifecycle roadmap"), render: page(() => import("./Roadmap"), "RoadmapPage") },
  { id: "adrs", group: "model", icon: NotebookPen, label: () => t("Decisions"), render: page(() => import("./Adrs"), "AdrsPage") },
  { id: "repository", group: "model", icon: Library, label: () => t("Architecture repository"), render: page(() => import("./Repository"), "RepositoryPage") },
  { id: "impact", group: "analyse", icon: Zap, label: () => t("Impact analysis"), render: page(() => import("./Impact"), "ImpactPage") },
  { id: "insights", group: "analyse", icon: ChartPie, label: () => t("Insights"), render: page(() => import("./Insights"), "InsightsPage") },
  { id: "rules", group: "analyse", icon: ListChecks, label: () => t("Architecture rules"), render: page(() => import("./Rules"), "RulesPage") },
  { id: "reports", group: "analyse", icon: Sheet, label: () => t("Catalogs and matrices"), render: page(() => import("./Reports"), "ReportsPage") },
  { id: "mappings", group: "connect", icon: ArrowLeftRight, label: () => t("Cross-notation mapping"), render: page(() => import("./Mappings"), "MappingsPage") },
  { id: "discover", group: "connect", icon: Radar, label: () => t("Discover"), render: page(() => import("./Discover"), "DiscoverPage") },
  { id: "plugins", group: "connect", icon: Puzzle, label: () => t("Plugins"), render: page(() => import("./Plugins"), "PluginsPage") },
  { id: "assistant", group: "app", icon: Sparkles, label: () => t("Assistant"), render: page(() => import("./Assistant"), "AssistantPage") },
  { id: "settings", group: "app", icon: Settings, label: () => t("Settings"), render: page(() => import("./Settings"), "SettingsPage") },
);

// Views whose viewpoint is a form (e.g. the Bounded Context Canvas) are drawn as a card instead of a node canvas.
extensions.viewRenderers.push((viewId) => {
  const v = model.state.views[viewId];
  return v && registry.viewpoint(v.notation, v.viewpoint)?.kind === "form" ? <FormView key={viewId} viewId={viewId} /> : undefined;
});
