import { Page, expect } from "@playwright/test";

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async loginAsStandardUser() {
    await this.page.locator("#user-name").fill("standard_user");
    await this.page.locator("#password").fill("secret_sauce");
    await this.page.locator("#login-button").click();
    await this.page.waitForURL("**/inventory.html", { waitUntil: "load" });
    await expect(this.page.locator(".inventory_list")).toBeVisible();
  }

  async assertError(message: string) {
    await expect(this.page.locator('[data-test="error"]')).toHaveText(
      new RegExp(message, "i"),
    );
  }

  async smokePage() {
    await expect(this.page).toHaveTitle(/Swag Labs/);
    await expect(this.page.locator("#login-button")).toBeVisible();
    await expect(this.page.locator("#user-name")).toBeVisible();
    await expect(this.page.locator("#password")).toBeVisible();
  }
}
