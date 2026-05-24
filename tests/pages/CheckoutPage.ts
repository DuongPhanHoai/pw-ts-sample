import { Page, expect } from "@playwright/test";

export type CheckoutCustomer = {
  firstName: string;
  lastName: string;
  postalCode: string;
};

export class CheckoutPage {
  constructor(private page: Page) {}

  /** Walk the entire checkout, filling the form with the supplied customer. */
  async checkoutFullFlow(customer: CheckoutCustomer) {
    await this.page.click("#checkout");
    await this.page.fill("#first-name", customer.firstName);
    await this.page.fill("#last-name", customer.lastName);
    await this.page.fill("#postal-code", customer.postalCode);
    await this.page.click("#continue");
    await expect(this.page.locator(".summary_info")).toBeVisible();

    await this.page.click("#finish");
    await expect(this.page.locator(".complete-header")).toHaveText(
      "Thank you for your order!",
    );
  }
}
