import { test, expect } from "@playwright/test";

test("smoke - saucedemo login page", async ({ page }) => {
  await page.goto("/"); // uses baseURL from config
  await expect(page).toHaveTitle(/Swag Labs/);
  await expect(page.locator("#login-button")).toBeVisible();
  await expect(page.locator("#user-name")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
});
