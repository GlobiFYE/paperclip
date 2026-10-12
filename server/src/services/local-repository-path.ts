import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve only Git transports that read the local host filesystem. */
export function localRepositoryPath(repoUrl: string): string | null {
  if (/^file:/i.test(repoUrl.trim())) {
    const localUrl = new URL(repoUrl);
    if (repoUrl !== repoUrl.trim() || localUrl.search || localUrl.hash) {
      throw new Error("Local repository URLs must not contain surrounding whitespace, queries, or fragments");
    }
    return fileURLToPath(localUrl);
  }
  return path.isAbsolute(repoUrl) ? repoUrl : null;
}
