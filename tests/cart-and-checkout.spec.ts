import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { InventoryPage } from "./pages/InventoryPage";
import { CheckoutPage } from "./pages/CheckoutPage";

test("add item to cart and checkout", async ({ page }) => {
  const login = new LoginPage(page);
  const inventory = new InventoryPage(page);
  const checkout = new CheckoutPage(page);

  // Login
  await login.goto();
  await login.loginAsStandardUser();

  // Add first item to cart (robust for Chromium)
  await inventory.addBackpackToCart();
  await inventory.openCart();
  await inventory.expectItemsInCart(1);

  // Checkout
  await checkout.checkoutFullFlow();
});
