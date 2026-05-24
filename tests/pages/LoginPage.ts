import { Page, expect } from "@playwright/test";

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  /** Fill the form and click submit. No post-conditions — caller decides what success looks like. */
  async loginAs(username: string, password: string) {
    await this.page.locator("#user-name").fill(username);
    await this.page.locator("#password").fill(password);
    await this.page.locator("#login-button").click();
  }

  /** Wait for the inventory page to load — call after a successful login. */
  async expectInventoryLoaded() {
    await this.page.waitForURL("**/inventory.html", { waitUntil: "load" });
    await expect(this.page.locator(".inventory_list")).toBeVisible();
  }

  /** Convenience: login as the default happy-path user and assert inventory is reachable. */
  async loginAsStandardUser() {
    await this.loginAs("standard_user", "secret_sauce");
    await this.expectInventoryLoaded();
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
