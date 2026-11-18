/// <reference lib="webworker" />
/**
 * Every built-in notation pack, importer and exporter runs here, behind the same sandbox RPC that
 * third-party plugins use. Nothing in this file is reachable from the UI thread except by message.
 */
import { guestMain, type Plugin, type Port } from "@vastitecture/plugin-sdk";
import generic from "@vastitecture/notation-generic";
import c4 from "@vastitecture/notation-c4";
import archimate from "@vastitecture/notation-archimate";
import ddd from "@vastitecture/notation-ddd";
import togaf from "@vastitecture/notation-togaf";
import inventory from "@vastitecture/notation-inventory";
import structurizr from "@vastitecture/io-structurizr";
import archimateIo from "@vastitecture/io-archimate";
import cml from "@vastitecture/io-cml";
import { extra } from "./builtin.extra";

const plugins: Plugin[] = [archimate, c4, ddd, togaf, generic, inventory, structurizr, archimateIo, cml, ...extra];

self.onmessage = () => void guestMain(self as unknown as Port, plugins.map((p) => ({ manifest: p.manifest!, plugin: p })));
self.postMessage({ t: "hello", manifests: plugins.map((p) => p.manifest) });
