import { test, expect } from "@playwright/test";

test("mock users API", async ({ page }) => {
  await page.route("**/api/users", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, name: "Mock User" }]),
    });
  });

  await page.goto("/api/users"); // your real app path
  await expect(page.getByText("Mock User")).toBeVisible();
});
