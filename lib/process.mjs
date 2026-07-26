import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { CliError } from "./errors.mjs";

function windowsExecutable(program, environment) {
  if (process.platform !== "win32" || extname(program)) {
    return null;
  }
  const pathEntries = (environment.PATH ?? "").split(delimiter);
  const extensions = (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(directory, `${program}${extension.toLowerCase()}`);
      const uppercaseCandidate = join(directory, `${program}${extension.toUpperCase()}`);
      if (existsSync(candidate)) {
        return candidate;
      }
      if (existsSync(uppercaseCandidate)) {
        return uppercaseCandidate;
      }
    }
  }
  return null;
}

export function invocation(program, argumentsList, environment = process.env) {
  const executable = windowsExecutable(program, environment);
  if (!executable || !/[.]cmd$|[.]bat$/i.test(executable)) {
    return { program: executable ?? program, argumentsList };
  }
  return {
    program: environment.ComSpec ?? "cmd.exe",
    argumentsList: ["/d", "/s", "/c", executable, ...argumentsList],
  };
}

export function runProcess(program, argumentsList, options = {}) {
  const environment = options.env ?? process.env;
  const resolved = invocation(program, argumentsList, environment);
  const result = spawnSync(resolved.program, resolved.argumentsList, {
    cwd: options.cwd,
    encoding: "utf8",
    env: environment,
    input: options.input,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

export function checked(program, argumentsList, options = {}) {
  const { run = runProcess, ...processOptions } = options;
  const result = run(program, argumentsList, processOptions);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new CliError(`${program} ${argumentsList.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`could not parse ${description}`);
  }
}

export function runProcessAsync(program, argumentsList, options = {}) {
  const environment = options.env ?? process.env;
  const resolved = invocation(program, argumentsList, environment);
  const child = spawn(resolved.program, resolved.argumentsList, {
    cwd: options.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    options.onStdout?.(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    options.onStderr?.(chunk);
  });
  const completion = new Promise((resolve) => {
    child.on("error", (error) => resolve({ status: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
  return { child, completion };
}
