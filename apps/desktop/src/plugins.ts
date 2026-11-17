import { Registry } from "@vastitecture/core";
import { activate, type Plugin } from "@vastitecture/plugin-sdk";
import generic from "@vastitecture/notation-generic";
import c4 from "@vastitecture/notation-c4";
import structurizr from "@vastitecture/io-structurizr";
import { httpFetch, secrets } from "./platform";

export const registry = new Registry();

/** Built-ins register through the same plugin API as third-party plugins. */
export const builtins: Plugin[] = [c4, generic, structurizr];

export const hostServices = { fetch: httpFetch, getSecret: secrets.get };

export async function activateBuiltins() {
  for (const p of builtins) await activate(p, registry, hostServices);
}
