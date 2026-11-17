import type { Plugin } from "@vastitecture/plugin-sdk";
import discovery from "@vastitecture/connectors-discovery";
import formats from "@vastitecture/io-formats";

/** Further built-in plugins (formats and connectors), loaded into the same worker. */
export const extra: Plugin[] = [discovery, formats];
