import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { BlockedError, UsageError } from "./errors.mjs";
import { inspectDoctor } from "./doctor.mjs";
import { runProcess, runProcessAsync } from "./process.mjs";

export const RUNNER_AGENTS = new Set(["codex", "claude", "cursor", "gemini"]);

function gitPath(cwd, run = runProcess) {
  const result = run("git", ["rev-parse", "--git-common-dir"], { cwd });
  if (result.status !== 0) {
    throw new UsageError("the current directory is not a Git repository; run gsd-loop init first");
  }
  const value = result.stdout.trim();
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function stateDirectory(cwd, run = runProcess) {
  return resolve(gitPath(cwd, run), "gsd-loop");
}

export function readRunnerConfig(cwd, run = runProcess) {
  const path = resolve(stateDirectory(cwd, run), "config.json");
  if (!existsSync(path)) {
    throw new UsageError("gsd-loop is not initialized in this repository; run gsd-loop init first");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function agentArguments(agent, prompt, autonomous = true) {
  if (agent === "codex") {
    const permissions = autonomous ? ["--dangerously-bypass-approvals-and-sandbox"] : [];
    return { program: "codex", argumentsList: ["exec", "--ephemeral", ...permissions, prompt] };
  }
  if (agent === "claude") {
    const permissions = autonomous ? ["--dangerously-skip-permissions"] : [];
    return { program: "claude", argumentsList: ["-p", "--output-format", "json", ...permissions, prompt] };
  }
  if (agent === "cursor") {
    const permissions = autonomous ? ["--force"] : [];
    return { program: "cursor-agent", argumentsList: ["-p", "--output-format", "json", ...permissions, prompt] };
  }
  if (agent === "gemini") {
    const permissions = autonomous ? ["--approval-mode=yolo"] : [];
    return { program: "gemini", argumentsList: ["-p", prompt, "--output-format", "json", ...permissions] };
  }
  if (agent === "kimi") {
    throw new UsageError("Kimi skills are installed for interactive use, but Kimi automation is disabled by policy");
  }
  throw new UsageError(`unsupported runner: ${agent}`);
}

function normalizedAgentOutput(agent, stdout) {
  if (!["claude", "cursor", "gemini"].includes(agent)) {
    return stdout;
  }
  try {
    const value = JSON.parse(stdout);
    return value.result ?? value.response ?? value.output ?? value.text ?? stdout;
  } catch {
    return stdout;
  }
}

export function parsePassResult(agent, stdout, lane) {
  const output = normalizedAgentOutput(agent, stdout);
  const matches = [...output.matchAll(/^GSD_LOOP_RESULT=(\{.*\})$/gm)];
  if (!matches.length) {
    throw new BlockedError("agent output is missing GSD_LOOP_RESULT; the lane was paused");
  }
  let result;
  try {
    result = JSON.parse(matches.at(-1)[1]);
  } catch {
    throw new BlockedError("agent returned an invalid GSD_LOOP_RESULT; the lane was paused");
  }
  if (result.lane !== lane || !["work", "idle", "blocked"].includes(result.status) || typeof result.reason !== "string") {
    throw new BlockedError("agent returned an invalid GSD_LOOP_RESULT; the lane was paused");
  }
  return result;
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function workspaceRoot(cwd, run) {
  const result = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.status !== 0) {
    throw new UsageError("the current directory is not a Git repository; run gsd-loop init first");
  }
  return result.stdout.trim();
}

function rejectActiveClaudeScheduler(cwd, run) {
  const path = resolve(workspaceRoot(cwd, run), ".claude", "scheduled_tasks.lock");
  if (!existsSync(path)) return;
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (Number.isInteger(lock.pid) && processIsRunning(lock.pid)) {
    throw new BlockedError(`Claude scheduler is active with PID ${lock.pid}; stop it before starting the portable runner`);
  }
}

function acquireLock(path, lane) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  try {
    const descriptor = openSync(path, "wx");
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, lane, startedAt: new Date().toISOString() })}\n`);
    closeSync(descriptor);
    return;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    lock = {};
  }
  if (Number.isInteger(lock.pid) && processIsRunning(lock.pid)) {
    throw new BlockedError(`another ${lane} runner is active with PID ${lock.pid}`);
  }
  rmSync(path, { force: true });
  acquireLock(path, lane);
}

function passPrompt(lane) {
  return `Use $gsd-loop-${lane}. Execute exactly one pass. Your final response must end with one line in this exact form: GSD_LOOP_RESULT={"lane":"${lane}","status":"work|idle|blocked","reason":"short-reason"}`;
}

function appendLog(directory, lane, result) {
  const entry = {
    at: new Date().toISOString(),
    status: result.status,
    reason: result.reason,
  };
  const path = resolve(directory, `${lane}.jsonl`);
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  if (lines.length > 200) {
    writeFileSync(path, `${lines.slice(-200).join("\n")}\n`);
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolveDelay) => {
    const timeout = setTimeout(() => resolveDelay(false), milliseconds);
    signal.cancel = () => {
      clearTimeout(timeout);
      resolveDelay(true);
    };
  });
}

export async function runLane({ cwd, lane, agent, once = false, run = runProcess }) {
  if (!["build", "review"].includes(lane)) {
    throw new UsageError("run requires one lane: build or review");
  }
  const config = readRunnerConfig(cwd, run);
  const selectedAgent = agent ?? config.agent;
  if (!RUNNER_AGENTS.has(selectedAgent)) {
    agentArguments(selectedAgent, "", true);
  }
  const readiness = inspectDoctor({ cwd, repo: config.repo, run });
  if (lane === "review" && !readiness.reviewReady) {
    throw new BlockedError("review is blocked until a required CI check is configured; rerun gsd-loop init");
  }
  const directory = stateDirectory(cwd, run);
  mkdirSync(directory, { recursive: true });
  rejectActiveClaudeScheduler(cwd, run);
  const lockPath = resolve(directory, `${lane}.lock`);
  acquireLock(lockPath, lane);
  const signal = { interrupted: false, cancel: null, child: null };
  const interrupt = () => {
    signal.interrupted = true;
    signal.cancel?.();
    signal.child?.kill("SIGINT");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let idleCount = 0;
  try {
    while (true) {
      const invocation = agentArguments(selectedAgent, passPrompt(lane), true);
      const execution = runProcessAsync(invocation.program, invocation.argumentsList, {
        cwd,
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
      });
      signal.child = execution.child;
      const completed = await execution.completion;
      signal.child = null;
      if (signal.interrupted) {
        return 130;
      }
      if (completed.status !== 0) {
        throw new BlockedError(`${selectedAgent} exited ${completed.status}: ${completed.stderr.trim() || "no error output"}`);
      }
      const result = parsePassResult(selectedAgent, completed.stdout, lane);
      appendLog(directory, lane, result);
      console.log(`${lane} pass: ${result.status} (${result.reason})`);
      if (result.status === "blocked") {
        return 3;
      }
      if (once) {
        return 0;
      }
      idleCount = result.status === "idle" ? idleCount + 1 : 0;
      if (idleCount >= 3) {
        console.log(`${lane} runner stopped after three consecutive idle passes`);
        return 0;
      }
      const interval = result.status === "work" ? 15 * 60_000 : 60 * 60_000;
      console.log(`next ${lane} pass in ${interval / 60_000} minutes`);
      const interrupted = await delay(interval, signal);
      if (interrupted) {
        return 130;
      }
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    rmSync(lockPath, { force: true });
  }
}
