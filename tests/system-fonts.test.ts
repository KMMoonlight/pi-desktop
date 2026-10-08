import test from "node:test";
import assert from "node:assert/strict";
import { readSystemFonts } from "../backend/system-fonts.ts";

test("macOS lists enabled font families rather than faces and file names", async () => {
  const result = await readSystemFonts("darwin", async (file, args) => {
    assert.equal(file, "/usr/sbin/system_profiler");
    assert.deepEqual(args, ["SPFontsDataType", "-json"]);
    return JSON.stringify({
      SPFontsDataType: [
        {
          enabled: "yes",
          typefaces: [
            { family: "Example Sans", style: "Regular" },
            { family: "Example Sans", style: "Bold" },
            { family: " 思源黑体 " },
            { family: ".Hidden UI Font" },
            { family: "\u202d.\u202cHidden UI Font" },
            { family: "\u202dExample Sans\u202c" },
            { family: "Disabled Face", enabled: "no" },
            { family: "Invalid Face", valid: "no" },
          ],
        },
        { enabled: "no", typefaces: [{ family: "Disabled Font File" }] },
        { valid: "no", typefaces: [{ family: "Invalid Font File" }] },
      ],
    });
  });
  assert.deepEqual(new Set(result), new Set(["Example Sans", "思源黑体"]));
});

test("Windows reads the system collection with UTF-8 output and no profile", async () => {
  const result = await readSystemFonts("win32", async (file, args) => {
    assert.equal(file, "powershell.exe");
    assert.ok(args.includes("-NoProfile"));
    assert.ok(args.includes("-NonInteractive"));
    assert.match(args.at(-1)!, /Fonts\]::SystemFontFamilies/);
    assert.match(args.at(-1)!, /OutputEncoding/);
    return '\uFEFF["微软雅黑", "Consolas", "Consolas", "@微软雅黑", null]';
  });
  assert.deepEqual(new Set(result), new Set(["Consolas", "微软雅黑"]));
  assert.deepEqual(
    await readSystemFonts("win32", async () => '["Only Font"]'),
    ["Only Font"],
  );
});

test("Linux requests canonical family names and preserves commas within names", async () => {
  const result = await readSystemFonts("linux", async (file, args) => {
    assert.equal(file, "fc-list");
    assert.deepEqual(args, ["--format", "%{family[0]}\n"]);
    return "Zulu Font\nAlpha Font\r\nFont, With Comma\nAlpha Font\n\n";
  });
  assert.deepEqual(result, ["Alpha Font", "Font, With Comma", "Zulu Font"]);
});

test("enumeration failures and invalid reports propagate so the UI can retry", async () => {
  await assert.rejects(
    readSystemFonts("linux", async () => {
      throw new Error("fc-list unavailable");
    }),
    /unavailable/,
  );
  await assert.rejects(
    readSystemFonts("darwin", async () => "{}"),
    /Invalid system font report/,
  );
  await assert.rejects(
    readSystemFonts("win32", async () => '"not an array"'),
    /Invalid system font report/,
  );
  await assert.rejects(
    readSystemFonts("freebsd", async () => ""),
    /unavailable/,
  );
});
