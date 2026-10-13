import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { scanStories } from "../../scripts/storybook-catalog.mjs";
const root = new URL("../../", import.meta.url).pathname;
const catalog = JSON.parse(
  readFileSync(
    new URL("../../maps/storybook-map/catalog.json", import.meta.url),
    "utf8",
  ),
);
const suites = catalog.entries.filter(
  (entry: { stableId: string }) =>
    entry.stableId.startsWith("feature-") &&
    !entry.stableId.startsWith("feature-map-"),
);
const parsed = scanStories(root);
let index: { entries: Record<string, { tags: string[] }> };
test.beforeAll(async ({ request }) => {
  const response = await request.get("/index.json");
  expect(response.ok()).toBe(true);
  index = await response.json();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const managerPath = info.outputPath("manager.txt");
    writeFileSync(managerPath, await page.locator("body").innerText());
    await info.attach("storybook-page", {
      path: managerPath,
      contentType: "text/plain",
    });
    const frame = page.frameLocator("#storybook-preview-iframe");
    const subjectPath = info.outputPath("subject.txt");
    writeFileSync(subjectPath, await frame.locator("body").innerText());
    await info.attach("storybook-subject", {
      path: subjectPath,
      contentType: "text/plain",
    });
  }
});
for (const suite of suites) {
  const file = parsed.find(
    (story: { file: string }) => story.file === suite.file,
  );
  for (const id of file.ids) {
    test(id, async ({ page }, info) => {
      expect(
        index.entries[id],
        `Rebuild Storybook to include ${id}`,
      ).toBeDefined();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/?path=/story/${id}`);
      const frame = page.frameLocator("#storybook-preview-iframe");
      await expect(frame.locator("body")).toHaveClass(/sb-show-main/);
      await expect(frame.locator(".sb-show-errordisplay")).toHaveCount(0);
      const interactions = page.getByRole("tab", { name: /^Interactions/ });
      await interactions.click();
      const status = page.locator('[aria-label^="Story status:"]');
      if (index.entries[id]?.tags.includes("play-fn")) {
        await expect(status).toHaveAttribute(
          "aria-label",
          "Story status: Pass",
        );
      }
      await expect(frame.locator("#storybook-root")).toBeAttached();
      expect(errors).toEqual([]);
      if (
        id.includes("accepted") ||
        id.includes("permission") ||
        id.includes("save-retention")
      )
        await page.screenshot({ path: info.outputPath(`${id}.png`) });
    });
  }
}

test("token fixtures reset when switching stories in one browser", async ({
  page,
}) => {
  await page.goto("/?path=/story/feature-gateway-tokens--issued-token");
  await page.getByRole("tab", { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label^="Story status:"]')).toHaveAttribute(
    "aria-label",
    "Story status: Pass",
  );
  await page.getByRole("link", { name: "Active Token", exact: true }).click();
  const frame = page.frameLocator("#storybook-preview-iframe");
  await frame.getByRole("button", { name: /Token history/ }).click();
  await expect(
    frame.getByText("Preview client", { exact: true }).first(),
  ).toBeVisible();
  await expect(frame.getByText("Review client", { exact: true })).toHaveCount(
    0,
  );
});

for (const theme of ["light", "dark"]) {
  test(`backup retention renders on mobile in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/iframe.html?id=feature-backup-retention--current-policy&viewMode=story&globals=theme:${theme}`,
    );
    await expect(page.getByRole("button", { name: "14 days" })).toBeVisible();
    await expect(page.locator(".sb-show-errordisplay")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`backup-mobile-${theme}.png`),
    });
  });
}
