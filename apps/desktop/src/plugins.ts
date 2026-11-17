import { Registry } from "@vastitecture/core";
import { activate, type Plugin } from "@vastitecture/plugin-sdk";
import generic from "@vastitecture/notation-generic";
import c4 from "@vastitecture/notation-c4";
import structurizr from "@vastitecture/io-structurizr";
import archimate from "@vastitecture/notation-archimate";
import archimateIo from "@vastitecture/io-archimate";
import ddd from "@vastitecture/notation-ddd";
import togaf from "@vastitecture/notation-togaf";
import inventory from "@vastitecture/notation-inventory";
import cml from "@vastitecture/io-cml";
import { httpFetch, secrets } from "./platform";

export const registry = new Registry();

/** Built-ins register through the same plugin API as third-party plugins. */
export const builtins: Plugin[] = [archimate, c4, ddd, togaf, generic, inventory, structurizr, archimateIo, cml];

export const hostServices = { fetch: httpFetch, getSecret: secrets.get };

export async function activateBuiltins() {
  for (const p of builtins) await activate(p, registry, hostServices);
}
