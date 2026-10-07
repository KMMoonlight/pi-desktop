import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSupportedImageMimeTypeFromFile } from "@earendil-works/pi-coding-agent";
import { loadTuiApi, type NativeClipboard } from "./tui-api.ts";

function command(
  name: string,
  args: string[],
  input?: string,
): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = execFile(
      name,
      args,
      {
        windowsHide: true,
        encoding: "buffer",
        timeout: 5000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, output) => resolve(error ? undefined : output),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

/** Native Pi clipboard, with Linux commands retaining selection ownership. */
export async function systemClipboard(): Promise<NativeClipboard | undefined> {
  const native = (await loadTuiApi()).getNativeClipboard();
  if (process.platform !== "linux") return native;
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  return {
    getFilePaths: () => native?.getFilePaths?.() ?? Promise.resolve(undefined),
    async getText() {
      if (wayland) {
        const bytes = await command("wl-paste", [
          "--no-newline",
          "--type",
          "text",
        ]);
        if (bytes !== undefined) return bytes.toString("utf8") || null;
      }
      return native?.getText() ?? undefined;
    },
    async getImage() {
      if (wayland) {
        const types = await command("wl-paste", ["--list-types"]);
        if (types !== undefined) {
          const formats = types
            .toString("utf8")
            .split(/\r?\n/)
            .map((type) => type.trim());
          const type =
            ["image/png", "image/jpeg", "image/webp", "image/gif"].find(
              (type) => formats.includes(type),
            ) ?? formats.find((type) => type.startsWith("image/"));
          if (!type) return null;
          const bytes = await command("wl-paste", [
            "--no-newline",
            "--type",
            type,
          ]);
          if (bytes !== undefined) return bytes.length ? bytes : null;
        }
      }
      return native?.getImage() ?? undefined;
    },
    async setText(text) {
      const candidates: [string, string[]][] = [
        ...(wayland ? [["wl-copy", []] as [string, string[]]] : []),
        ...(process.env.DISPLAY
          ? ([
              ["xclip", ["-selection", "clipboard"]],
              ["xsel", ["--clipboard", "--input"]],
            ] as [string, string[]][])
          : []),
      ];
      for (const [name, args] of candidates)
        if ((await command(name, args, text)) !== undefined) return;
      throw new Error("System clipboard is unavailable");
    },
  };
}

export async function clipboardImage(bytes: Uint8Array) {
  if (bytes.length > 5 * 1024 * 1024)
    throw new Error("Clipboard image exceeds 5 MB");
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-clipboard-"));
  try {
    const path = join(directory, "image");
    await writeFile(path, bytes, { mode: 0o600 });
    let mimeType = await detectSupportedImageMimeTypeFromFile(path);
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        mimeType ?? "",
      )
    ) {
      const require = createRequire(
        import.meta.resolve("@earendil-works/pi-coding-agent"),
      );
      const photon = require("@silvia-odwyer/photon-node") as {
        PhotonImage: {
          new_from_byteslice(bytes: Uint8Array): {
            get_bytes(): Uint8Array;
            free(): void;
          };
        };
      };
      const image = photon.PhotonImage.new_from_byteslice(bytes);
      try {
        bytes = image.get_bytes();
      } finally {
        image.free();
      }
      mimeType = "image/png";
    }
    if (bytes.length > 5 * 1024 * 1024)
      throw new Error("Clipboard image exceeds 5 MB");
    return {
      name: "Clipboard image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: mimeType!,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
