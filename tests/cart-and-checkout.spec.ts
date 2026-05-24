import { test } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { InventoryPage } from "./pages/InventoryPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { products, customers } from "./data";

test.describe("cart and checkout (data-driven)", () => {
  for (const product of products) {
    for (const customer of customers) {
      test(`checkout "${product.name}" as ${customer.firstName} ${customer.lastName}`, async ({
        page,
      }) => {
        const login = new LoginPage(page);
        const inventory = new InventoryPage(page);
        const checkout = new CheckoutPage(page);

        await login.goto();
        await login.loginAsStandardUser();

        await inventory.addItemToCart(product.slug);
        await inventory.openCart();
        await inventory.expectItemsInCart(1);

        await checkout.checkoutFullFlow(customer);
      });
    }
  }
});
