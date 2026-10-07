import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function (context, { directory, reject = false }) {
  const before = context.session.sessionId;
  await writeFile(join(directory, "sdk-drain-ready.txt"), "ready");
  if (!context.signal.aborted)
    await new Promise((done) =>
      context.signal.addEventListener("abort", done, { once: true }),
    );
  await writeFile(join(directory, "sdk-drain-aborted.txt"), "aborted");
  while (!existsSync(join(directory, "sdk-drain-release.txt")))
    await new Promise((done) => setTimeout(done, 10));
  const result = {
    aborted: context.signal.aborted,
    sessionAlive: context.session.sessionId === before,
    version: context.sdk.VERSION,
  };
  await writeFile(
    join(directory, "sdk-drain-complete.json"),
    JSON.stringify(result),
  );
  if (reject) throw new Error("SDK drain caller failure");
  return result;
}
