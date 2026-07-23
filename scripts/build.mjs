import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { force: true, recursive: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
execFileSync("npx", ["tsc", "-p", "tsconfig.cjs.json"], { stdio: "inherit" });
mkdirSync("dist/cjs", { recursive: true });
writeFileSync("dist/cjs/package.json", '{"type":"commonjs"}\n');
