import { Page, expect } from "@playwright/test";

export class InventoryPage {
  constructor(private page: Page) {}

  /** Click the add-to-cart button for a product identified by its data-test slug. */
  async addItemToCart(slug: string) {
    await this.page.locator(`[data-test="add-to-cart-${slug}"]`).click();
  }

  /** Convenience wrapper kept for backward compatibility. */
  async addBackpackToCart() {
    await this.addItemToCart("sauce-labs-backpack");
  }

  async openCart() {
    await this.page.click(".shopping_cart_link");
  }

  async expectItemsInPage(count: number) {
    await expect(this.page.locator(".inventory_item")).toHaveCount(count);
  }

  async expectItemsInCart(count: number) {
    await expect(this.page.locator(".cart_item")).toHaveCount(count);
  }

  async smokePage() {
    await this.page.goto("/inventory.html");
    await expect(this.page.locator(".inventory_list")).toBeVisible();
    await expect(
      this.page.locator(".inventory_item_name").first(),
    ).toBeVisible();
  }
}
