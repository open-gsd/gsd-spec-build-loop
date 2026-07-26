import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const SKILLS = [
  "gsd-loop-spec",
  "gsd-loop-build",
  "gsd-loop-review",
  "gsd-loop-schedule",
];
export const SUPPORTED_AGENTS = new Set(["codex", "claude", "cursor", "gemini", "kimi"]);

const MARKER = ".gsd-loop-install.json";
const MARKER_CONTENT = { installer: "gsd-loop", format: 1 };
const ADAPTER_MARKER_SUFFIX = ".gsd-loop-adapter.json";
const ADAPTER_MARKER_CONTENT = { installer: "gsd-loop", format: 1, adapter: "symlink" };

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isSymlink(path) {
  return pathExists(path) && lstatSync(path).isSymbolicLink();
}

function markerMatches(path, expected) {
  if (!pathExists(path) || isSymlink(path) || !lstatSync(path).isFile()) {
    return false;
  }
  try {
    const actual = JSON.parse(readFileSync(path, "utf8"));
    return Object.keys(actual).length === Object.keys(expected).length
      && Object.entries(expected).every(([key, value]) => actual[key] === value);
  } catch {
    return false;
  }
}

function isOwnedDirectory(path) {
  return pathExists(path)
    && !isSymlink(path)
    && lstatSync(path).isDirectory()
    && markerMatches(join(path, MARKER), MARKER_CONTENT);
}

function adapterMarker(destination) {
  return join(dirname(destination), `.${basename(destination)}${ADAPTER_MARKER_SUFFIX}`);
}

function resolvedPath(path) {
  let current = resolve(path);
  const missing = [];
  while (true) {
    try {
      return resolve(realpathSync(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        return resolve(path);
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

function pathsAlias(first, second) {
  return resolvedPath(first) === resolvedPath(second);
}

function isOwnedAdapter(destination, canonical) {
  return isSymlink(destination)
    && pathsAlias(destination, canonical)
    && markerMatches(adapterMarker(destination), ADAPTER_MARKER_CONTENT);
}

function removePath(path) {
  if (pathExists(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function temporaryPath(parent, prefix) {
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

function moveToBackup(path) {
  if (!pathExists(path)) {
    return null;
  }
  const backup = temporaryPath(dirname(path), `.${basename(path)}.previous-`);
  rmSync(backup, { recursive: true });
  renameSync(path, backup);
  return backup;
}

function cleanupBackup(path) {
  if (!path) {
    return;
  }
  try {
    removePath(path);
  } catch (error) {
    console.error(`warning: could not remove backup ${path}: ${error.message}`);
  }
}

function restorePath(backup, destination, errors) {
  if (!backup) {
    return;
  }
  try {
    removePath(destination);
    renameSync(backup, destination);
  } catch (error) {
    errors.push(error);
  }
}

function replacePath(stage, destination) {
  const backup = moveToBackup(destination);
  try {
    renameSync(stage, destination);
  } catch (error) {
    const rollbackErrors = [];
    restorePath(backup, destination, rollbackErrors);
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], "replacement and rollback failed");
    }
    throw error;
  }
  cleanupBackup(backup);
}

function stageSkill(sourceRoot, destination, skill) {
  const stage = temporaryPath(dirname(destination), `.${skill}.`);
  try {
    cpSync(join(sourceRoot, ".agents", "skills", skill), stage, { recursive: true });
    const lane = skill.replace("gsd-loop-", "");
    if (["spec", "build", "review"].includes(lane)) {
      cpSync(join(sourceRoot, "loop", `${lane}.md`), join(stage, "playbook.md"));
    } else {
      const scripts = join(stage, "scripts");
      mkdirSync(scripts, { recursive: true });
      for (const script of ["doctor.sh", "scheduler-policy.sh"]) {
        cpSync(join(sourceRoot, "scripts", script), join(scripts, script));
      }
    }
    writeFileSync(join(stage, MARKER), `${JSON.stringify(MARKER_CONTENT)}\n`);
    return stage;
  } catch (error) {
    removePath(stage);
    throw error;
  }
}

function stageAdapter(canonical, destination, mode) {
  const stage = temporaryPath(dirname(destination), `.${basename(destination)}.`);
  removePath(stage);
  try {
    if (mode === "auto" || mode === "symlink") {
      try {
        symlinkSync(canonical, stage, platform() === "win32" ? "junction" : "dir");
        return stage;
      } catch (error) {
        if (mode === "symlink") {
          throw error;
        }
      }
    }
    cpSync(canonical, stage, { recursive: true });
    return stage;
  } catch (error) {
    removePath(stage);
    throw error;
  }
}

function stageAdapterMarker(destination) {
  const stage = temporaryPath(dirname(destination), `.${basename(destination)}.marker.`);
  removePath(stage);
  writeFileSync(stage, `${JSON.stringify(ADAPTER_MARKER_CONTENT)}\n`);
  return stage;
}

function replaceAdapter(stage, destination) {
  const marker = adapterMarker(destination);
  const markerStage = isSymlink(stage) ? stageAdapterMarker(destination) : null;
  let destinationBackup = null;
  let markerBackup = null;
  let destinationInstalled = false;
  let markerInstalled = false;

  try {
    destinationBackup = moveToBackup(destination);
    markerBackup = moveToBackup(marker);
    renameSync(stage, destination);
    destinationInstalled = true;
    if (markerStage) {
      renameSync(markerStage, marker);
      markerInstalled = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    if (markerInstalled) {
      try {
        removePath(marker);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (destinationInstalled) {
      try {
        removePath(destination);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    restorePath(markerBackup, marker, rollbackErrors);
    restorePath(destinationBackup, destination, rollbackErrors);
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], "adapter replacement and rollback failed");
    }
    throw error;
  } finally {
    if (markerStage) {
      removePath(markerStage);
    }
  }

  cleanupBackup(markerBackup);
  cleanupBackup(destinationBackup);
}

function preflight(canonicalRoot, claudeRoot, agents, adapterMode) {
  const conflicts = [];
  for (const skill of SKILLS) {
    const destination = join(canonicalRoot, skill);
    if (pathExists(destination) && !isOwnedDirectory(destination)) {
      conflicts.push(destination);
    }
  }
  if (!agents.has("claude") || pathsAlias(canonicalRoot, claudeRoot)) {
    return conflicts;
  }
  for (const skill of SKILLS) {
    const destination = join(claudeRoot, skill);
    const canonical = join(canonicalRoot, skill);
    const marker = adapterMarker(destination);
    const ownedAdapter = isOwnedAdapter(destination, canonical);
    if (pathExists(marker) && !ownedAdapter) {
      conflicts.push(marker);
    }
    if (!pathExists(destination)) {
      continue;
    }
    if (isSymlink(destination)
      && pathsAlias(destination, canonical)
      && (adapterMode !== "copy" || ownedAdapter)) {
      continue;
    }
    if (!isOwnedDirectory(destination)) {
      conflicts.push(destination);
    }
  }
  return conflicts;
}

function installCanonical(sourceRoot, canonicalRoot) {
  for (const skill of SKILLS) {
    const destination = join(canonicalRoot, skill);
    const stage = stageSkill(sourceRoot, destination, skill);
    try {
      replacePath(stage, destination);
    } finally {
      removePath(stage);
    }
  }
}

function installClaudeAdapters(canonicalRoot, claudeRoot, mode) {
  if (pathsAlias(canonicalRoot, claudeRoot)) {
    return;
  }
  mkdirSync(claudeRoot, { recursive: true });
  for (const skill of SKILLS) {
    const canonical = join(canonicalRoot, skill);
    const destination = join(claudeRoot, skill);
    if (isSymlink(destination) && pathsAlias(destination, canonical) && mode !== "copy") {
      continue;
    }
    const stage = stageAdapter(canonical, destination, mode);
    try {
      replaceAdapter(stage, destination);
    } finally {
      removePath(stage);
    }
  }
}

function parseAgents(value) {
  const requested = new Set(value.split(",").map((agent) => agent.trim().toLowerCase()).filter(Boolean));
  if (!requested.size || (requested.size === 1 && requested.has("all"))) {
    return new Set(SUPPORTED_AGENTS);
  }
  const unknown = [...requested].filter((agent) => !SUPPORTED_AGENTS.has(agent));
  if (unknown.length) {
    throw new Error(`unsupported agent(s): ${unknown.sort().join(", ")}`);
  }
  return requested;
}

export function parseInstallArguments(argumentsList) {
  const options = {
    home: homedir(),
    agents: new Set(SUPPORTED_AGENTS),
    adapterMode: "auto",
    dryRun: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (["--home", "--agents", "--adapter-mode"].includes(argument)) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--home") {
        options.home = value;
      } else if (argument === "--agents") {
        options.agents = parseAgents(value);
      } else if (["auto", "symlink", "copy"].includes(value)) {
        options.adapterMode = value;
      } else {
        throw new Error(`unsupported adapter mode: ${value}`);
      }
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

export function install({ sourceRoot, home, agents, adapterMode, dryRun }) {
  const targetHome = resolve(home);
  const canonicalRoot = join(targetHome, ".agents", "skills");
  const claudeRoot = join(targetHome, ".claude", "skills");
  const conflicts = preflight(canonicalRoot, claudeRoot, agents, adapterMode);
  if (conflicts.length) {
    throw new Error(conflicts.map((path) => `refusing to overwrite unowned path: ${path}`).join("\n"));
  }

  console.log(`shared skills: ${canonicalRoot}`);
  if (agents.has("claude")) {
    console.log(`Claude adapters: ${claudeRoot} (${adapterMode})`);
  }
  console.log(`agents: ${[...agents].sort().join(", ")}`);
  if (dryRun) {
    console.log("dry run; no files written");
    return;
  }

  installCanonical(sourceRoot, canonicalRoot);
  if (agents.has("claude")) {
    installClaudeAdapters(canonicalRoot, claudeRoot, adapterMode);
  }
  console.log(`installed ${SKILLS.length} gsd-loop skills`);
}
