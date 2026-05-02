import { test, expect } from "@playwright/test";

test("add item to cart and checkout", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto("/");
  await page.locator("#user-name").fill("standard_user");
  await page.locator("#password").fill("secret_sauce");
  await page.locator("#login-button").click();
  await page.waitForURL("**/inventory.html", { waitUntil: "load" });

  // Add first item to cart (robust for Chromium)
  // await page.getByRole('button', { name: 'Add to cart' }).first().click();

  // By data-test attribute (if present)
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();

  // Open cart and verify 1 item
  await page.click(".shopping_cart_link");
  await expect(page.locator(".cart_item")).toHaveCount(1);

  // Checkout
  await page.click("#checkout");
  await page.fill("#first-name", "Test");
  await page.fill("#last-name", "User");
  await page.fill("#postal-code", "12345");
  await page.click("#continue");
  await expect(page.locator(".summary_info")).toBeVisible();

  await page.click("#finish");
  await expect(page.locator(".complete-header")).toHaveText(
    "Thank you for your order!",
  );

  await context.close();
});
