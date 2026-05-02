import { Page, expect } from "@playwright/test";

export async function loginAsStandardUser(page: Page) {
  await page.goto("/");
  await page.locator("#user-name").fill("standard_user");
  await page.locator("#password").fill("secret_sauce");
  await page.locator("#login-button").click();
  await page.waitForURL("**/inventory.html", { waitUntil: "load" });
  await expect(page.locator(".inventory_list")).toBeVisible();
}
