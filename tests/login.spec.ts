import { test } from "./fixtures";
import { LoginPage } from "./pages/LoginPage";
import { users } from "./data";

test.describe("login (data-driven)", () => {
  for (const user of users) {
    const label = user.shouldLogin ? "success" : "failure";
    test(`login: ${user.username} (${label})`, async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.loginAs(user.username, user.password);

      if (user.shouldLogin) {
        await login.expectInventoryLoaded();
      } else {
        await login.assertError(user.expectedError!);
      }
    });
  }
});
