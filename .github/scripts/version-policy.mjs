import { pathToFileURL } from "node:url";
import { checkRepositoryVersion } from "../../scripts/release-version.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [baseRef, headRef] = process.argv.slice(2);
    if (!baseRef || !headRef) throw new Error("Usage: node version-policy.mjs <current-main-ref> <pr-head-ref>");
    console.log(`Version policy passed: ${checkRepositoryVersion(baseRef, headRef)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
