import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export default async function ({ session, sdk }, { action }) {
  if (action === "prepare-image") {
    await writeFile(
      join(session.sessionManager.getCwd(), "pi-120-image.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACiqeP8EkgJKJCPrYwAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  }
  if (action === "cleanup")
    await rm(join(session.sessionManager.getCwd(), "pi-120-image.png"), {
      force: true,
    });
  return { version: sdk.VERSION };
}
