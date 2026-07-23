import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tagVersion = (process.env.RELEASE_TAG ?? "").replace(/^v/, "");
if (!tagVersion || packageJson.version !== tagVersion) {
  throw new Error(
    `Release tag ${JSON.stringify(process.env.RELEASE_TAG)} does not match package version ${JSON.stringify(packageJson.version)}`,
  );
}
