import test from "node:test";
import assert from "node:assert/strict";
import { componentText } from "../backend/component-text.ts";
import { loadComponentRuntime } from "../backend/component-runtime.ts";
import { desktopExternalLink } from "../shared/links.ts";

test("desktop links preserve mail and phone targets while rejecting active-content and malformed URLs", async () => {
  const { text: api } = await loadComponentRuntime();
  const urls = [
    "mailto:pi@example.invalid?subject=Pi%20desktop",
    "tel:+15550123456",
    "HTTPS://example.com/path?q=1#part",
    "vscode://file/C:/work/a.ts:12:3",
    "obsidian://open?vault=Notes&file=hello%20world",
    "pi-test:open?id=1",
    "PI-TEST:open",
  ];
  for (const url of urls) {
    const result = componentText(
      `\x1b]8;;${url}\x1b\\Contact\x1b]8;;\x1b\\ plain`,
      api,
    );
    assert.equal(result.runs?.[0].href, new URL(url).href);
    assert.equal(result.runs?.[1].href, undefined);
  }
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "vbscript:msgbox(1)",
    "JaVaScRiPt:alert(1)",
    "blob:https://example.com/id",
    "about:blank",
    "C:/a.exe",
    "C:\\a.exe",
    "pi-test:",
    "mailto:",
    "tel:",
    "//example.com",
    "/relative",
    "https://example.com/\nother",
    "mailto:a@example.com\x1b]0;title",
  ]) {
    assert.equal(desktopExternalLink(url), undefined, url);
  }
});

test("repeated SGR decorations reset once, including repetitions inside one sequence", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[1;1;3;3;4;4;5;5;7;7;8;8;9;9mRepeated\x1b[22;23;24;25;27;28;29m Plain",
    api,
  );
  assert.equal(value.runs?.[0].style?.fontWeight, "bold");
  assert.deepEqual(value.runs?.[1], { text: " Plain" });
});

test("colon SGR colors preserve RGB, palette and independent resets", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[38:2::10:20:30;48:5:24mColor\x1b[39m Background\x1b[49m Plain\x1b[38:2:11:22:33mShort RGB\x1b[0m",
    api,
  );
  assert.deepEqual(value.runs?.[0].style, {
    color: "rgb(10, 20, 30)",
    backgroundColor: "#005f87",
  });
  assert.deepEqual(value.runs?.[1].style, { backgroundColor: "#005f87" });
  assert.equal(value.runs?.[2].style, undefined);
  assert.equal(value.runs?.[3].style?.color, "rgb(11, 22, 33)");
  assert.deepEqual(componentText("\x1b[38:2:1:2mInvalid", api), {
    text: "Invalid",
  });
  const malformed = componentText(
    "\x1b[31mRed\x1b[38:2:1:10:20:30mUnknown space\x1b[48;2;999;3;4mBad channels\x1b[999999999999999999999999999999mUnknown code",
    api,
  );
  for (const run of malformed.runs ?? [])
    assert.deepEqual(run.style, { color: "#800000" });
});

test("extended underlines and overline retain their styles, colors and resets", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[1;4:3;58:2::10:20:30;53mWavy\x1b[4:2;58;5;196mDouble\x1b[24mOverline\x1b[55;59;22mPlain",
    api,
  );
  assert.deepEqual(value.runs?.[0].style, {
    fontWeight: "bold",
    textDecorationLine: "underline overline",
    textDecorationStyle: "wavy",
    textDecorationColor: "rgb(10, 20, 30)",
  });
  assert.equal(value.runs?.[1].style?.textDecorationStyle, "double");
  assert.equal(value.runs?.[1].style?.textDecorationColor, "#ff0000");
  assert.deepEqual(value.runs?.[2].style, {
    fontWeight: "bold",
    textDecorationLine: "overline",
  });
  assert.equal(value.runs?.[3].style, undefined);
  const reset = componentText(
    "\x1b[31;4:3;58;2;10;20;30mColored\x1b[59mDefault underline\x1b[0mPlain",
    api,
  );
  assert.deepEqual(reset.runs?.[1].style, {
    color: "#800000",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
  });
  assert.equal(reset.runs?.[2].style, undefined);
  for (const [mode, style] of [
    [1, "solid"],
    [2, "double"],
    [3, "wavy"],
    [4, "dotted"],
    [5, "dashed"],
  ] as const) {
    const runs = componentText(`\x1b[4:${mode}mStyled\x1b[4:0mPlain`, api).runs;
    assert.equal(runs?.[0].style?.textDecorationStyle, style);
    assert.equal(runs?.[1].style, undefined);
  }
});

test("text styling retains Pi palettes, compound decorations and independent resets", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[31;44;1;3;4;9mCombined\x1b[39;49;22;23;24;29m Plain\x1b[38;5;196m Palette\x1b[0m",
    api,
  );
  assert.equal(value.text, "Combined Plain Palette");
  assert.deepEqual(value.runs?.[0].style, {
    color: "#800000",
    backgroundColor: "#000080",
    fontWeight: "bold",
    fontStyle: "italic",
    textDecorationLine: "underline line-through",
  });
  assert.equal(value.runs?.[1].style, undefined);
  assert.equal(value.runs?.[2].style?.color, "#ff0000");
  assert.deepEqual(componentText("Unstyled next component", api), {
    text: "Unstyled next component",
  });
});

test("OSC 8 links preserve styled text boundaries while other terminal instructions remain inert", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[38;2;10;20;30mBefore \x1b]8;;https://example.com/a\x1b\\linked\x1b]8;;\x1b\\ after\x1b[39m\x1b]8;;javascript:alert(1)\x07 unsafe\x1b]8;;\x07 <b>literal</b>\x1b[2J\x1b]0;title\x07\x1b_Gpayload\x1b\\",
    api,
  );
  assert.equal(value.text, "Before linked after unsafe <b>literal</b>");
  const linked = value.runs?.find((run) => run.text === "linked");
  assert.equal(linked?.href, "https://example.com/a");
  assert.equal(linked?.style?.color, "rgb(10, 20, 30)");
  const after = value.runs?.find((run) => run.text === " after");
  assert.equal(after?.href, undefined);
  assert.equal(after?.style?.color, "rgb(10, 20, 30)");
  assert.equal(value.runs?.filter((run) => run.href).length, 1);
});

test("reverse, dim, hidden and blink text retain independent terminal decoration lifetimes", async () => {
  const { text: api } = await loadComponentRuntime();
  const value = componentText(
    "\x1b[2;5;7;8mConcealed\x1b[22;25;27;28m Visible\x1b[31;44;7m Swapped\x1b[0m",
    api,
  );
  assert.deepEqual(value.runs?.[0], {
    text: "Concealed",
    style: {
      color: "var(--desktop-text-background, var(--page))",
      backgroundColor: "var(--desktop-text-foreground, var(--text))",
      opacity: 0.6,
      visibility: "hidden",
    },
    blink: true,
  });
  assert.deepEqual(value.runs?.[1], { text: " Visible" });
  assert.deepEqual(value.runs?.[2].style, {
    color: "#000080",
    backgroundColor: "#800000",
  });
});
