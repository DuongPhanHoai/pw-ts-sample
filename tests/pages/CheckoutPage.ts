import { Page, expect } from "@playwright/test";

export class CheckoutPage {
  constructor(private page: Page) {}

  async checkoutFullFlow() {
    await this.page.click("#checkout");
    await this.page.fill("#first-name", "Test");
    await this.page.fill("#last-name", "User");
    await this.page.fill("#postal-code", "12345");
    await this.page.click("#continue");
    await expect(this.page.locator(".summary_info")).toBeVisible();

    await this.page.click("#finish");
    await expect(this.page.locator(".complete-header")).toHaveText(
      "Thank you for your order!",
    );
  }
}
