import { test, expect } from "@playwright/test";

const STORAGE = "storageState.json";

test("login and save auth state", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/");

  await page.locator("#user-name").fill("standard_user");
  await page.locator("#password").fill("secret_sauce");
  await page.locator("#login-button").click();

  // Recommended: wait for URL instead of waitForNavigation
  await page.waitForURL("**/inventory.html", { waitUntil: "load" });

  await expect(page.locator(".inventory_list")).toBeVisible();

  await context.storageState({ path: STORAGE });
  await context.close();
});

test("reuse saved state to open inventory", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  await page.goto("/inventory.html");
  await expect(page.locator(".inventory_list")).toBeVisible();
  await expect(page.locator(".inventory_item_name").first()).toBeVisible();

  await context.close();
});
