import { createHash } from "node:crypto";

export function makeImportSourceKey(contentHash: string, sourcePath: string) {
  const pathHash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
  return `import:${contentHash}:${pathHash}`;
}
