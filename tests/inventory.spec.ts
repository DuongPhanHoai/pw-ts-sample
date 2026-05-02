import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { InventoryPage } from "./pages/InventoryPage";

test.describe("inventory actions", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAsStandardUser();
  });

  test("has at least one product", async ({ page }) => {
    const count = await page.locator(".inventory_item").count();
    expect(count).toBeGreaterThan(0);
  });

  test("can add backpack to cart", async ({ page }) => {
    const inventory = new InventoryPage(page);

    await inventory.addBackpackToCart();
    await inventory.openCart();
    await inventory.expectItemsInCart(1);
  });
});
