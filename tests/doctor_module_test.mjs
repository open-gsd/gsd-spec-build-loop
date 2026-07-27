import assert from "node:assert/strict";
import { inspectDoctor, LABELS } from "../lib/doctor.mjs";

const calls = [];
const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `label-${index}` }));
const secondPage = LABELS.map((name) => ({ name }));

function run(program, argumentsList) {
  calls.push({ program, argumentsList });
  if (argumentsList[0] === "--version" || argumentsList[0] === "auth") {
    return { status: 0, stdout: "", stderr: "" };
  }
  if (argumentsList[0] !== "api") {
    return { status: 1, stdout: "", stderr: "unexpected command" };
  }
  const endpoint = argumentsList.find((argument) => argument.startsWith("repos/"));
  if (endpoint === "repos/octocat/project") {
    return {
      status: 0,
      stdout: JSON.stringify({ permissions: { push: true }, default_branch: "main" }),
      stderr: "",
    };
  }
  if (endpoint === "repos/octocat/project/labels?per_page=100") {
    return { status: 0, stdout: JSON.stringify([firstPage, secondPage]), stderr: "" };
  }
  if (endpoint === "repos/octocat/project/rules/branches/main") {
    return { status: 0, stdout: "[]", stderr: "" };
  }
  return { status: 1, stdout: "", stderr: "unexpected endpoint" };
}

const report = inspectDoctor({
  cwd: "/tmp/project",
  repo: "octocat/project",
  run,
});

assert.deepEqual(report.missingLabels, []);
const labelCall = calls.find(({ argumentsList }) => (
  argumentsList.includes("repos/octocat/project/labels?per_page=100")
));
assert.ok(labelCall);
assert.ok(labelCall.argumentsList.includes("--paginate"));
assert.ok(labelCall.argumentsList.includes("--slurp"));

console.log("doctor label pagination passed");
