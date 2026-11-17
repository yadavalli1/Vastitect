import type { Plugin } from "@vastitecture/plugin-sdk";
import discovery from "@vastitecture/connectors-discovery";

/** Further built-in plugins (formats and connectors), loaded into the same worker. */
export const extra: Plugin[] = [discovery];
