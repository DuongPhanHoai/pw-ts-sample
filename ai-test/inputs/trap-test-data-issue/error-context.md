# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.ts >> login (data-driven) >> login: standard_user (success)
- Location: tests\login.spec.ts:8:9

# Error details

```
Test timeout of 10000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 10000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/inventory.html" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: Swag Labs
  - generic [ref=e5]:
    - generic [ref=e9]:
      - generic [ref=e10]:
        - textbox "Username" [ref=e11]: standard_user
        - img [ref=e12]
      - generic [ref=e14]:
        - textbox "Password" [ref=e15]: bad_password
        - img [ref=e16]
      - 'heading "Epic sadface: Username and password do not match any user in this service" [level=3] [ref=e19]':
        - button [ref=e20] [cursor=pointer]:
          - img [ref=e21]
        - text: "Epic sadface: Username and password do not match any user in this service"
      - button "Login" [active] [ref=e23] [cursor=pointer]
    - generic [ref=e25]:
      - generic [ref=e26]:
        - heading "Accepted usernames are:" [level=4] [ref=e27]
        - text: standard_user
        - text: locked_out_user
        - text: problem_user
        - text: performance_glitch_user
        - text: error_user
        - text: visual_user
      - generic [ref=e28]:
        - heading "Password for all users:" [level=4] [ref=e29]
        - text: secret_sauce
```

# Test source

```ts
  1  | import { Page, expect } from "@playwright/test";
  2  | 
  3  | export class LoginPage {
  4  |   constructor(private page: Page) {}
  5  | 
  6  |   async goto() {
  7  |     await this.page.goto("/");
  8  |   }
  9  | 
  10 |   /** Fill the form and click submit. No post-conditions — caller decides what success looks like. */
  11 |   async loginAs(username: string, password: string) {
  12 |     await this.page.locator("#user-name").fill(username);
  13 |     await this.page.locator("#password").fill(password);
  14 |     await this.page.locator("#login-button").click();
  15 |   }
  16 | 
  17 |   /** Wait for the inventory page to load — call after a successful login. */
  18 |   async expectInventoryLoaded() {
> 19 |     await this.page.waitForURL("**/inventory.html", { waitUntil: "load" });
     |                     ^ Error: page.waitForURL: Test timeout of 10000ms exceeded.
  20 |     await expect(this.page.locator(".inventory_list")).toBeVisible();
  21 |   }
  22 | 
  23 |   /** Convenience: login as the default happy-path user and assert inventory is reachable. */
  24 |   async loginAsStandardUser() {
  25 |     await this.loginAs("standard_user", "secret_sauce");
  26 |     await this.expectInventoryLoaded();
  27 |   }
  28 | 
  29 |   async assertError(message: string) {
  30 |     await expect(this.page.locator('[data-test="error"]')).toHaveText(
  31 |       new RegExp(message, "i"),
  32 |     );
  33 |   }
  34 | 
  35 |   async smokePage() {
  36 |     await expect(this.page).toHaveTitle(/Swag Labs/);
  37 |     await expect(this.page.locator("#login-button")).toBeVisible();
  38 |     await expect(this.page.locator("#user-name")).toBeVisible();
  39 |     await expect(this.page.locator("#password")).toBeVisible();
  40 |   }
  41 | }
```