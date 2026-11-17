import { useEffect, useMemo, useRef, useState } from "react";
import "monaco-editor/esm/vs/editor/edcore.main";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { codeToCommands, syncViewFromPatch, viewToCode, type Command, type Id } from "@vastitecture/core";
import { dispatch, model, registry, useApp, useModel, useRegistryVersion } from "../state";
import { sizeOf } from "../ops";
import { t } from "../i18n";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** Monarch grammars for the two modelling DSLs. */
function registerLanguages() {
  if (monaco.languages.getLanguages().some((l) => l.id === "structurizr")) return;
  const brace = { brackets: [["{", "}"]] as [string, string][], comments: { lineComment: "//", blockComment: ["/*", "*/"] as [string, string] }, autoClosingPairs: [{ open: "{", close: "}" }, { open: '"', close: '"' }] };
  monaco.languages.register({ id: "structurizr", extensions: [".dsl"] });
  monaco.languages.setLanguageConfiguration("structurizr", brace);
  monaco.languages.setMonarchTokensProvider("structurizr", {
    ignoreCase: true,
    keywords: ["workspace", "model", "views", "person", "softwareSystem", "container", "component", "deploymentEnvironment", "deploymentNode", "infrastructureNode", "containerInstance", "softwareSystemInstance", "group", "systemLandscape", "systemContext", "dynamic", "deployment", "include", "exclude", "autoLayout", "title", "description", "technology", "tags", "url", "properties", "styles", "element", "relationship", "shape", "theme", "themes"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/->/, "operator"],
        [/![a-zA-Z]+/, "keyword.directive"],
        [/[a-zA-Z_][\w.]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[{}]/, "delimiter.bracket"],
        [/=/, "operator"],
      ],
      comment: [[/\*\//, "comment", "@pop"], [/./, "comment"]],
    },
  });
  monaco.languages.register({ id: "cml", extensions: [".cml"] });
  monaco.languages.setLanguageConfiguration("cml", brace);
  monaco.languages.setMonarchTokensProvider("cml", {
    keywords: ["ContextMap", "BoundedContext", "Domain", "Subdomain", "Aggregate", "Entity", "ValueObject", "DomainEvent", "CommandEvent", "Service", "Module", "contains", "implements", "type", "state", "domainVisionStatement", "responsibilities", "implementationTechnology", "knowledgeLevel", "realizes", "refines", "owner", "exposedAggregates", "downstreamRights", "Partnership", "SharedKernel", "Customer-Supplier", "Upstream-Downstream", "Downstream-Upstream", "UseCase", "CORE_DOMAIN", "SUPPORTING_DOMAIN", "GENERIC_SUBDOMAIN", "TEAM", "FEATURE", "APPLICATION", "SYSTEM", "aggregateRoot", "event", "command"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/<->|->|<-/, "operator"],
        [/\b(U|D|P|SK|OHS|PL|ACL|CF|S|C)\b/, "type"],
        [/[A-Za-z_][\w-]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[{}[\]()]/, "delimiter.bracket"],
      ],
      comment: [[/\*\//, "comment", "@pop"], [/./, "comment"]],
    },
  });
}

interface Format {
  id: string;
  label: string;
  language: string;
  toText(viewId: Id): Promise<string> | string;
  toCommands(viewId: Id, text: string): Promise<Command[]> | Command[];
}

function formatsFor(notation: string): Format[] {
  const out: Format[] = [
    { id: "yaml", label: "YAML", language: "yaml", toText: (v) => viewToCode(model.state, v), toCommands: (v, text) => codeToCommands(model.state, v, text, sizeOf) },
  ];
  for (const e of registry.exporters.values()) {
    const imp = e.roundTripWith ? registry.importers.get(e.roundTripWith) : undefined;
    if (e.scope !== "view" || !imp || (e.notations && !e.notations.includes(notation))) continue;
    out.push({
      id: e.id,
      label: e.label.replace(/\s*\(.*\)$/, ""),
      language: e.language ?? "plaintext",
      toText: async (v) => String(await e.export(model.state, { view: v })),
      toCommands: async (v, text) => syncViewFromPatch(model.state, v, await imp.import({ name: "editor." + e.extension, text }, model.state), sizeOf),
    });
  }
  return out;
}

/** Split view: text on one side, canvas on the other, synced both ways. */
export default function CodePane({ viewId }: { viewId: Id }) {
  useRegistryVersion();
  const view = useModel((ws) => ws.views[viewId]);
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const theme = useApp((s) => s.theme);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>();
  const programmatic = useRef(false);
  const [formatId, setFormatId] = useState("yaml");
  const [error, setError] = useState<string>();
  const formats = useMemo(() => formatsFor(view?.notation ?? ""), [view?.notation]);
  const format = formats.find((f) => f.id === formatId) ?? formats[0];
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    registerLanguages();
    const ed = monaco.editor.create(host.current!, { value: "", language: "yaml", automaticLayout: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, tabSize: 2, ariaLabel: t("Diagram source"), wordWrap: "on" });
    editor.current = ed;
    // Test hook: read and replace the editor text the same way a user edit would.
    (window as unknown as { __vastitecture: Record<string, unknown> }).__vastitecture.code = { get: () => ed.getValue(), set: (text: string) => (ed.focus(), ed.setValue(text)) };
    let timer: ReturnType<typeof setTimeout>;
    const apply = async () => {
      try {
        const cmds = await formatRef.current.toCommands(viewId, ed.getValue());
        setError(undefined);
        if (cmds.length) dispatch(cmds, t("Edit as code"));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    ed.onDidChangeModelContent(() => {
      if (programmatic.current) return;
      clearTimeout(timer);
      timer = setTimeout(apply, 450);
    });
    // Leaving the editor normalises the text back to the canonical form of the model.
    ed.onDidBlurEditorText(() => void refresh(true));
    return () => {
      clearTimeout(timer);
      ed.dispose();
    };
  }, [viewId]);

  const refresh = async (force = false) => {
    const ed = editor.current;
    if (!ed || (!force && ed.hasTextFocus())) return;
    const text = await formatRef.current.toText(viewId);
    if (text === ed.getValue()) return;
    programmatic.current = true;
    ed.setValue(text);
    programmatic.current = false;
    setError(undefined);
  };

  useEffect(() => {
    void refresh();
  }, [view, elements, relationships]);
  useEffect(() => {
    const m = editor.current?.getModel();
    if (m) monaco.editor.setModelLanguage(m, format.language);
    void refresh(true);
  }, [format.id]);
  useEffect(() => monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs"), [theme]);

  return (
    <section className="panel chrome flex flex-col border-l" style={{ width: "40%", minWidth: 320 }} aria-label={t("Diagram as code")} data-testid="code-pane">
      <div className="flex items-center gap-2" style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
        <strong>{t("Code")}</strong>
        <select className="btn" aria-label={t("Language")} value={format.id} onChange={(e) => setFormatId(e.target.value)}>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 11 }}>{t("Edits apply as you type; undo works across text and canvas.")}</span>
      </div>
      <div ref={host} style={{ flex: 1, minHeight: 0 }} />
      {error && <div role="alert" className="sev-error" style={{ padding: "4px 8px", borderTop: "1px solid var(--border)", fontSize: 12 }} data-testid="code-error">{error}</div>}
    </section>
  );
}
