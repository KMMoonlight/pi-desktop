import { test, expect } from "@playwright/test";
import { verifyModalEditor } from "../editor-workflows.ts";

for (const width of [1440, 390])
  test(`official modal editor uses native editing, modes, selection, paste and submission at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 940 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyModalEditor(
      page,
      `.local/screenshots/official-editor-${width}.png`,
    );
    expect(errors).toEqual([]);
  });
