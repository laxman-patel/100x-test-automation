import { runScenario } from "./lib/runner";

function parseArgs(args: string[]) {
  const parsed = {
    scenario: "scenarios/smoke-extension-toggle.json",
    session: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--session") {
      parsed.session = args[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      parsed.scenario = arg;
    }
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));

const result = await runScenario(args.scenario, {
  session: args.session,
  onLog: (line) => console.log(line),
});

if (!result.ok) {
  process.exitCode = 1;
}
