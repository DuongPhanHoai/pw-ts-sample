import { Page, expect } from "@playwright/test";

export class InventoryPage {
  constructor(private page: Page) {}

  async addBackpackToCart() {
    await this.page
      .locator('[data-test="add-to-cart-sauce-labs-backpack"]')
      .click();
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
