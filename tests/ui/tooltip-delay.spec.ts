import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const uiPath = "/src/ui.tsx";
    const primitivesPath = "/src/primitives.tsx";
    const iconsPath = "/node_modules/.vite/deps/lucide-react.js";
    const [react, dom, ui, primitives, icons] = await Promise.all([
      import(reactPath),
      import(domPath),
      import(uiPath),
      import(primitivesPath),
      import(iconsPath),
    ]);
    const h = react.createElement ?? react.default.createElement;
    const host = document.createElement("div");
    host.id = "tooltip-delay-fixture";
    host.style.cssText =
      "position:fixed;left:400px;top:200px;z-index:30000;display:flex;gap:24px";
    document.body.appendChild(host);
    const root = (dom.createRoot ?? dom.default.createRoot)(host);
    root.render(
      h(
        "div",
        {},
        h(
          ui.Hint,
          { text: "Hint tooltip" },
          h("button", { id: "tooltip-hint" }, "Hint trigger"),
        ),
        h(ui.IconButton, {
          label: "Icon tooltip",
          icon: icons.HelpCircle,
          onClick: () => {},
        }),
        h(
          primitives.Tooltip,
          { text: "Direct tooltip" },
          (attributes: object) =>
            h(
              "button",
              { ...attributes, id: "tooltip-direct" },
              "Direct trigger",
            ),
        ),
      ),
    );
    (
      window as unknown as { unmountTooltipFixture: () => void }
    ).unmountTooltipFixture = () => {
      root.unmount();
      host.remove();
    };
  });
  await expect(page.locator("#tooltip-hint")).toBeVisible();
  const now = new Date("2026-10-08T12:00:00Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
});

test("all shared tooltip entry points wait 500ms before showing", async ({
  page,
}) => {
  for (const [selector, text] of [
    ["#tooltip-hint", "Hint tooltip"],
    [
      '#tooltip-delay-fixture button[aria-label="Icon tooltip"]',
      "Icon tooltip",
    ],
    ["#tooltip-direct", "Direct tooltip"],
  ]) {
    const trigger = page.locator(selector);
    await trigger.dispatchEvent("mouseover");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(trigger).not.toHaveAttribute("aria-describedby");
    await page.clock.runFor(499);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.getByRole("tooltip")).toHaveText(text);
    expect(await trigger.getAttribute("aria-describedby")).toBe(
      await page.getByRole("tooltip").getAttribute("id"),
    );
    await trigger.dispatchEvent("mouseout");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
});

test("leaving, pointer presses, scrolling, losing focus and unmounting cancel pending tooltips", async ({
  page,
}) => {
  const trigger = page.locator("#tooltip-hint");
  for (const reason of ["leave", "click", "scroll", "window-blur"]) {
    await trigger.dispatchEvent("mouseover");
    await page.clock.runFor(250);
    if (reason === "leave") await trigger.dispatchEvent("mouseout");
    if (reason === "click") await trigger.dispatchEvent("pointerdown");
    if (reason === "scroll")
      await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    if (reason === "window-blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await trigger.dispatchEvent("mouseout");
  }
  await trigger.focus();
  await page.clock.runFor(499);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.getByRole("tooltip")).toHaveText("Hint tooltip");
  await trigger.evaluate((node) => node.blur());
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await trigger.focus();
  await page.clock.runFor(250);
  await trigger.evaluate((node) => node.blur());
  await page.clock.runFor(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await trigger.dispatchEvent("mouseover");
  await page.clock.runFor(250);
  await page.evaluate(() =>
    (
      window as unknown as { unmountTooltipFixture: () => void }
    ).unmountTooltipFixture(),
  );
  await page.clock.runFor(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
