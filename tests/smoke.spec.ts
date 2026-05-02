import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";

test("smoke - saucedemo login page", async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.smokePage();
});
