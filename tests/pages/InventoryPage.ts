import { Page, expect } from "@playwright/test";

export class InventoryPage {
  constructor(private page: Page) {}

  /** Click the add-to-cart button for a product identified by its data-test slug. */
  async addItemToCart(slug: string) {
    await this.page.locator(`[data-test="add-to-cart-${slug}"]`).click();
  }

  async openCart() {
    await this.page.click(".shopping_cart_link");
  }

  async expectItemsInCart(count: number) {
    await expect(this.page.locator(".cart_item")).toHaveCount(count);
  }
}
