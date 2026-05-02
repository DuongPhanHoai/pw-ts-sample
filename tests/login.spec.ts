import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { InventoryPage } from "./pages/InventoryPage";

const STORAGE = "storageState.json";

test("login and save auth state", async ({ page }) => {
  // log all requests
  page.on("request", (req) => {
    console.log(">>", req.method(), req.url());
  });

  const login = new LoginPage(page);

  await login.goto();
  await login.loginAsStandardUser();
});

test("reuse saved state to open inventory", async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.loginAsStandardUser();
  const inventory = new InventoryPage(page);
  await inventory.smokePage();
});
