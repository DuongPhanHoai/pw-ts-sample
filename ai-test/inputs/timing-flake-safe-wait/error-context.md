# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: _capture-timing-flake.spec.ts >> timing flake on checkout summary panel
- Location: tests\_capture-timing-flake.spec.ts:9:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.summary_info')
Expected: visible
Timeout: 50ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 50ms
  - waiting for locator('.summary_info')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]:
          - button "Open Menu" [ref=e8] [cursor=pointer]
          - img "Open Menu" [ref=e9]
        - generic [ref=e11]: Swag Labs
        - generic [ref=e14]: "1"
      - generic [ref=e16]: "Checkout: Overview"
    - generic [ref=e18]:
      - generic [ref=e19]:
        - generic [ref=e20]: QTY
        - generic [ref=e21]: Description
        - generic [ref=e22]:
          - generic [ref=e23]: "1"
          - generic [ref=e24]:
            - link "Sauce Labs Backpack" [ref=e25] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e26]: Sauce Labs Backpack
            - generic [ref=e27]: carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection.
            - generic [ref=e29]: $29.99
      - generic [ref=e30]:
        - generic [ref=e31]: "Payment Information:"
        - generic [ref=e32]: "SauceCard #31337"
        - generic [ref=e33]: "Shipping Information:"
        - generic [ref=e34]: Free Pony Express Delivery!
        - generic [ref=e35]: Price Total
        - generic [ref=e36]: "Item total: $29.99"
        - generic [ref=e37]: "Tax: $2.40"
        - generic [ref=e38]: "Total: $32.39"
        - generic [ref=e39]:
          - button "Go back Cancel" [ref=e40] [cursor=pointer]:
            - img "Go back" [ref=e41]
            - text: Cancel
          - button "Finish" [ref=e42] [cursor=pointer]
  - contentinfo [ref=e43]:
    - list [ref=e44]:
      - listitem [ref=e45]:
        - link "Twitter" [ref=e46] [cursor=pointer]:
          - /url: https://twitter.com/saucelabs
      - listitem [ref=e47]:
        - link "Facebook" [ref=e48] [cursor=pointer]:
          - /url: https://www.facebook.com/saucelabs
      - listitem [ref=e49]:
        - link "LinkedIn" [ref=e50] [cursor=pointer]:
          - /url: https://www.linkedin.com/company/sauce-labs/
    - generic [ref=e51]: © 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy
```

# Test source

```ts
  1  | import { test, expect } from "./fixtures";
  2  | import { LoginPage } from "./pages/LoginPage";
  3  | import { InventoryPage } from "./pages/InventoryPage";
  4  | import { customers, products } from "./data";
  5  | 
  6  | const product = products[0]!;
  7  | const customer = customers[0]!;
  8  | 
  9  | test("timing flake on checkout summary panel", async ({ page }) => {
  10 |   const login = new LoginPage(page);
  11 |   const inventory = new InventoryPage(page);
  12 |   await login.goto();
  13 |   await login.loginAsStandardUser();
  14 |   await inventory.addItemToCart(product.slug);
  15 |   await inventory.openCart();
  16 |   await page.click("#checkout");
  17 |   await page.fill("#first-name", customer.firstName);
  18 |   await page.fill("#last-name", customer.lastName);
  19 |   await page.fill("#postal-code", customer.postalCode);
  20 |   await Promise.all([
  21 |     page.locator("#continue").click(),
> 22 |     expect(page.locator(".summary_info")).toBeVisible({ timeout: 50 }),
     |                                           ^ Error: expect(locator).toBeVisible() failed
  23 |   ]);
  24 | });
  25 | 
```