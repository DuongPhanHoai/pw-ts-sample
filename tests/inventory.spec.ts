import { test, expect } from "@playwright/test";
import { loginAsStandardUser } from "./helpers";

test.describe("inventory actions", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStandardUser(page);
  });

  test("has at least one product", async ({ page }) => {
    const count = await page.locator(".inventory_item").count();
    expect(count).toBeGreaterThan(0);
  });

  test("can add backpack to cart", async ({ page }) => {
    await page.locator('[data-test="add-to-cart-sauce-labs-bbackpack"]').click();
    await page.click(".shopping_cart_link");
    await expect(page.locator(".cart_item")).toHaveCount(1);
  });
});
