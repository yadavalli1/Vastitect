/// <reference types="vite/client" />
declare module "elkjs/lib/elk-worker.min.js?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
declare module "monaco-editor/esm/vs/editor/edcore.main";
declare module "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
declare module "monaco-editor/esm/vs/editor/editor.worker?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
