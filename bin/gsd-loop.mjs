#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDoctor, inspectDoctor } from "../lib/doctor.mjs";
import { CliError, UsageError } from "../lib/errors.mjs";
import { initialize, parseInitArguments } from "../lib/init.mjs";
import { install, parseInstallArguments } from "../lib/install.mjs";
import { parseOutcomeArguments, syncIssueOutcomes } from "../lib/outcomes.mjs";
import { runLane, schedulerDecision } from "../lib/runner.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const argumentsList = process.argv.slice(2);

function usage() {
  return `Usage:
  gsd-loop install [options]
  gsd-loop init [options]
  gsd-loop doctor [--review-ready] [--json] [--repo OWNER/NAME]
  gsd-loop outcomes ISSUE complete|pending --repo OWNER/NAME --pr NUMBER --head SHA
  gsd-loop run build|review [--agent NAME] [--once]
  gsd-loop policy work|idle|blocked IDLE_COUNT

Install skills, prepare a repository, and keep one-pass work lanes running.

Install options:
  --home PATH                       install beneath an alternate home directory
  --agents LIST                     codex,claude,cursor,gemini,kimi (default: all)
  --adapter-mode auto|symlink|copy  Claude adapter behavior (default: auto)
  --dry-run                         show destinations without writing

Init options:
  --repo OWNER/NAME                 target GitHub repository
  --create-repo                     allow creation in an empty directory
  --visibility private|public       visibility for a created repository
  --required-check NAME             successful CI check to require
  --runner NAME                     codex,claude,cursor,gemini
  --yes                             apply an unambiguous preview without prompting

Run options:
  --agent NAME                      override the configured runner
  --once                            execute one pass without sleeping

General options:
  -h, --help                        show help
  -v, --version                     show version`;
}

function parseDoctorArguments(values) {
  const options = { reviewReady: false, json: false, repo: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--review-ready") options.reviewReady = true;
    else if (value === "--json") options.json = true;
    else if (value === "--repo") {
      options.repo = values[index + 1];
      if (!options.repo || options.repo.startsWith("--")) throw new UsageError("--repo requires OWNER/NAME");
      index += 1;
    } else throw new UsageError(`unknown option: ${value}`);
  }
  return options;
}

function parseRunArguments(values) {
  const lane = values.shift();
  const options = { lane, agent: null, once: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--once") options.once = true;
    else if (value === "--agent") {
      options.agent = values[index + 1];
      if (!options.agent || options.agent.startsWith("--")) throw new UsageError("--agent requires a value");
      index += 1;
    } else throw new UsageError(`unknown option: ${value}`);
  }
  return options;
}

try {
  if (argumentsList.includes("--version") || argumentsList.includes("-v")) {
    console.log(metadata.version);
    process.exit(0);
  }
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const command = argumentsList[0] && !argumentsList[0].startsWith("-")
    ? argumentsList.shift()
    : "install";
  if (command === "install") {
    const options = parseInstallArguments(argumentsList);
    install({ ...options, sourceRoot: packageRoot });
  } else if (command === "init") {
    const options = parseInitArguments(argumentsList);
    process.exitCode = await initialize({ sourceRoot: packageRoot, cwd: process.cwd(), options });
  } else if (command === "doctor") {
    const options = parseDoctorArguments(argumentsList);
    const report = inspectDoctor({ cwd: process.cwd(), repo: options.repo });
    console.log(options.json ? JSON.stringify(report) : formatDoctor(report));
    if (options.reviewReady && !report.reviewReady) process.exitCode = 3;
  } else if (command === "outcomes") {
    const options = parseOutcomeArguments(argumentsList);
    const changed = syncIssueOutcomes({ cwd: process.cwd(), ...options });
    const state = changed ? options.state : `already ${options.state}`;
    console.log(`issue #${options.issue} outcomes: ${state}`);
  } else if (command === "run") {
    const options = parseRunArguments(argumentsList);
    process.exitCode = await runLane({ cwd: process.cwd(), ...options });
  } else if (command === "policy") {
    if (argumentsList.length !== 2 || !/^\d+$/.test(argumentsList[1])) {
      throw new UsageError("policy requires work|idle|blocked and a non-negative idle count");
    }
    const decision = schedulerDecision(argumentsList[0], Number(argumentsList[1]));
    console.log(`action=${decision.action} interval_minutes=${decision.intervalMinutes} idle_count=${decision.idleCount}`);
  } else {
    throw new UsageError(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(`gsd-loop: ${error.message}`);
  process.exit(error instanceof CliError ? error.exitCode : 1);
}
