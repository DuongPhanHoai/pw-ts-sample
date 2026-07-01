# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cart-and-checkout.spec.ts >> cart and checkout (data-driven) >> checkout "Sauce Labs Backpack" as Test User
- Location: tests\cart-and-checkout.spec.ts:10:11

# Error details

```
Test timeout of 10000ms exceeded.
```

```
Error: page.click: Test timeout of 10000ms exceeded.
Call log:
  - waiting for locator('#btn-checkout')

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
      - generic [ref=e16]: Your Cart
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
            - generic [ref=e28]:
              - generic [ref=e29]: $29.99
              - button "Remove" [ref=e30] [cursor=pointer]
      - generic [ref=e31]:
        - button "Go back Continue Shopping" [ref=e32] [cursor=pointer]:
          - img "Go back" [ref=e33]
          - text: Continue Shopping
        - button "Checkout" [ref=e34] [cursor=pointer]
  - contentinfo [ref=e35]:
    - list [ref=e36]:
      - listitem [ref=e37]:
        - link "Twitter" [ref=e38] [cursor=pointer]:
          - /url: https://twitter.com/saucelabs
      - listitem [ref=e39]:
        - link "Facebook" [ref=e40] [cursor=pointer]:
          - /url: https://www.facebook.com/saucelabs
      - listitem [ref=e41]:
        - link "LinkedIn" [ref=e42] [cursor=pointer]:
          - /url: https://www.linkedin.com/company/sauce-labs/
    - generic [ref=e43]: © 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy
```

# Test source

```ts
  1  | import { Page, expect } from "@playwright/test";
  2  | 
  3  | export type CheckoutCustomer = {
  4  |   firstName: string;
  5  |   lastName: string;
  6  |   postalCode: string;
  7  | };
  8  | 
  9  | export class CheckoutPage {
  10 |   constructor(private page: Page) {}
  11 | 
  12 |   /** Walk the entire checkout, filling the form with the supplied customer. */
  13 |   async checkoutFullFlow(customer: CheckoutCustomer) {
> 14 |     await this.page.click("#btn-checkout");
     |                     ^ Error: page.click: Test timeout of 10000ms exceeded.
  15 |     await this.page.fill("#first-name", customer.firstName);
  16 |     await this.page.fill("#last-name", customer.lastName);
  17 |     await this.page.fill("#postal-code", customer.postalCode);
  18 |     await this.page.click("#continue");
  19 |     await expect(this.page.locator(".summary_info")).toBeVisible();
  20 | 
  21 |     await this.page.click("#finish");
  22 |     await expect(this.page.locator(".complete-header")).toHaveText(
  23 |       "Thank you for your order!",
  24 |     );
  25 |   }
  26 | }
  27 | 
```