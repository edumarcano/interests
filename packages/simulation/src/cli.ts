#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "@interests/engine";

import {
  DEFAULT_BASELINE_GAMES,
  DEFAULT_BASELINE_QUARTERS,
  runPassiveBaselineBatch,
} from "./baseline";
import { runFinanceAcceptanceScenarios } from "./financeScenarios";
import { DEFAULT_SIMULATION_SEED_PREFIX } from "./seed";
import { SIMULATION_VERSION } from "./version";

function printHelp(): void {
  console.log(`
Deterministic Financial Simulation CLI

Usage:
  pnpm --filter @interests/simulation simulate [options]

Options:
  --scenario <name>                passive-baseline-v1 (default) or finance-acceptance-v1
  --games <positive integer>        Number of games to simulate (default: ${DEFAULT_BASELINE_GAMES})
  --quarters <positive integer>     Quarter horizon per game (default: ${DEFAULT_BASELINE_QUARTERS})
  --seed-prefix <string>            Seed prefix for batch generation (default: "${DEFAULT_SIMULATION_SEED_PREFIX}")
  -h, --help                        Show this help message

Outputs:
  Emits formatted JSON report to stdout.
  Errors and diagnostic messages are written to stderr.
`);
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        scenario: { type: "string" },
        games: {
          type: "string",
        },
        quarters: {
          type: "string",
        },
        "seed-prefix": {
          type: "string",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
      allowPositionals: false,
    });

    if (values.help) {
      printHelp();
      return;
    }

    if (values.scenario === "finance-acceptance-v1") {
      if (
        values.games !== undefined ||
        values.quarters !== undefined ||
        values["seed-prefix"] !== undefined
      ) {
        throw new Error(
          "finance-acceptance-v1 uses fixed seeds and four-quarter scenarios; omit batch options",
        );
      }
      console.log(
        JSON.stringify(
          {
            scenario: "finance-acceptance-v1",
            simulationVersion: SIMULATION_VERSION,
            engineVersion: ENGINE_VERSION,
            workspaceCompatibility: WORKSPACE_COMPATIBILITY,
            scenarios: runFinanceAcceptanceScenarios(),
          },
          null,
          2,
        ),
      );
      return;
    }
    if (
      values.scenario !== undefined &&
      values.scenario !== "passive-baseline-v1"
    )
      throw new Error(`Unknown scenario: ${values.scenario}`);
    let games = DEFAULT_BASELINE_GAMES;
    if (values.games !== undefined) {
      const parsed = Number(values.games);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        console.error(
          `Error: --games must be a positive safe integer, got "${values.games}"`,
        );
        process.exit(1);
      }
      games = parsed;
    }

    let quarters = DEFAULT_BASELINE_QUARTERS;
    if (values.quarters !== undefined) {
      const parsed = Number(values.quarters);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        console.error(
          `Error: --quarters must be a positive safe integer, got "${values.quarters}"`,
        );
        process.exit(1);
      }
      quarters = parsed;
    }

    let seedPrefix = DEFAULT_SIMULATION_SEED_PREFIX;
    if (values["seed-prefix"] !== undefined) {
      const prefix = values["seed-prefix"];
      if (prefix.trim() === "") {
        console.error(
          `Error: --seed-prefix must be a non-empty string, got "${prefix}"`,
        );
        process.exit(1);
      }
      seedPrefix = prefix;
    }

    const report = runPassiveBaselineBatch({
      gameCount: games,
      quarterCount: quarters,
      seedPrefix,
    });

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(
      `Simulation fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// Execute if run directly via tsx/node
main();
