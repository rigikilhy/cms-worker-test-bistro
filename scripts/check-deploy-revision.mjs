import { execFileSync } from "node:child_process";
const branch = process.env.GITHUB_BRANCH;
if (!branch || /[\s\x00-\x1f]/.test(branch) || branch.startsWith("-")) throw new Error("Invalid deployment branch");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const remote = execFileSync("git", ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`], { encoding: "utf8" }).trim().split(/\s+/)[0];
if (!/^[a-f0-9]{40}$/.test(process.env.EXPECTED_COMMIT_SHA ?? "") || revision !== process.env.EXPECTED_COMMIT_SHA || revision !== remote) {
  throw new Error("A newer revision is saved. This stale deployment was stopped; retry publication from the CMS.");
}
