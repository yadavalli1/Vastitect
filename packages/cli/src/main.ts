import { run } from "./cli";

const code = await run(process.argv.slice(2), { out: (s) => process.stdout.write(s + "\n"), err: (s) => process.stderr.write(s + "\n"), cwd: process.cwd() });
process.exitCode = code;
