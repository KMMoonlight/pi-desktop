import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  VERSION,
  type DefaultProjectTrust,
  type LoadExtensionsResult,
  type ProjectTrustContext,
  type ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

interface TrustOptions {
  cwd: string;
  trustStore: ProjectTrustStore;
  defaultProjectTrust: DefaultProjectTrust;
  extensionsResult: LoadExtensionsResult;
  projectTrustContext: ProjectTrustContext;
  onExtensionError(message: string): void;
}
let resolver:
  | Promise<{
      resolveProjectTrusted(options: TrustOptions): Promise<boolean>;
    }>
  | undefined;

/** Pi's bootstrap resolver is internal; delegate to the pinned original implementation. */
export async function resolveProjectTrusted(options: TrustOptions) {
  if (VERSION !== "1.0.0")
    throw new Error(
      `Pi ${VERSION}: the desktop project trust bridge requires a compatibility update`,
    );
  const native = await (resolver ??= import(
    pathToFileURL(join(getPackageDir(), "dist", "core", "project-trust.js"))
      .href
  ));
  return native.resolveProjectTrusted(options);
}
