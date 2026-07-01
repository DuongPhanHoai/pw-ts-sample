# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cart-and-checkout.spec.ts >> cart and checkout (data-driven) >> checkout "Sauce Labs Backpack" as Test User
- Location: tests\cart-and-checkout.spec.ts:10:11

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.complete-header')
Expected: "Thanks for your purchase!"
Received: "Thank you for your order!"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.complete-header')
    9 × locator resolved to <h2 class="complete-header" data-test="complete-header">Thank you for your order!</h2>
      - unexpected value "Thank you for your order!"

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
      - generic [ref=e15]: "Checkout: Complete!"
    - generic [ref=e16]:
      - img "Pony Express" [ref=e17]
      - heading "Thank you for your order!" [level=2] [ref=e18]
      - generic [ref=e19]: Your order has been dispatched, and will arrive just as fast as the pony can get there!
      - button "Back Home" [ref=e20] [cursor=pointer]
  - contentinfo [ref=e21]:
    - list [ref=e22]:
      - listitem [ref=e23]:
        - link "Twitter" [ref=e24] [cursor=pointer]:
          - /url: https://twitter.com/saucelabs
      - listitem [ref=e25]:
        - link "Facebook" [ref=e26] [cursor=pointer]:
          - /url: https://www.facebook.com/saucelabs
      - listitem [ref=e27]:
        - link "LinkedIn" [ref=e28] [cursor=pointer]:
          - /url: https://www.linkedin.com/company/sauce-labs/
    - generic [ref=e29]: © 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy
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
  14 |     await this.page.click("#checkout");
  15 |     await this.page.fill("#first-name", customer.firstName);
  16 |     await this.page.fill("#last-name", customer.lastName);
  17 |     await this.page.fill("#postal-code", customer.postalCode);
  18 |     await this.page.click("#continue");
  19 |     await expect(this.page.locator(".summary_info")).toBeVisible();
  20 | 
  21 |     await this.page.click("#finish");
> 22 |     await expect(this.page.locator(".complete-header")).toHaveText(
     |                                                         ^ Error: expect(locator).toHaveText(expected) failed
  23 |       "Thanks for your purchase!",
  24 |     );
  25 |   }
  26 | }
  27 | 
```