import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Node loads local, production and base env without overriding the process; env:init preserves files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nuelexity-env-"));
  try {
    await writeFile(path.join(cwd, ".env"), "BASE=base\nLOCAL=base\nMODE=base\nSHELL=base\n");
    await writeFile(path.join(cwd, ".env.production"), "MODE=production\nLOCAL=production\n");
    await writeFile(path.join(cwd, ".env.local"), "LOCAL=local\n");
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      const {loadEnvironment} = await import(${JSON.stringify(new URL("../scripts/load-env.mjs", import.meta.url).href)});
      loadEnvironment("production");
      console.log(JSON.stringify([process.env.BASE, process.env.MODE, process.env.LOCAL, process.env.SHELL]));
    `], { cwd, env: { SHELL: "explicit" }, encoding: "utf8" });
    expect(JSON.parse(result)).toEqual(["base", "production", "local", "explicit"]);
    const before = await readFile(path.join(cwd, ".env"), "utf8");
    await writeFile(path.join(cwd, ".env.example"), "NEW=example\n");
    const init = fileURLToPath(new URL("../scripts/init-env.mjs", import.meta.url));
    execFileSync(process.execPath, [init], { cwd });
    expect(await readFile(path.join(cwd, ".env"), "utf8")).toBe(before);
    await rm(path.join(cwd, ".env"));
    execFileSync(process.execPath, [init], { cwd });
    expect(await readFile(path.join(cwd, ".env"), "utf8")).toBe("NEW=example\n");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
