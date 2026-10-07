import { expect, test } from "@playwright/test";

test("a graceful SDK shutdown leaves the browser in a closed state", async ({
  page,
}) => {
  await page.route("**/api/events?*", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"shutdown"}\n\n',
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Pi 已关闭");
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveCount(0);
});
