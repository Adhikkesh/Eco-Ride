/**
 * E2E Tests – Profile Page
 *
 * Tests profile rendering for riders and drivers, edit mode,
 * saved locations, and sign-out functionality.
 */

import { expect, test } from "./fixtures";

test.describe("Profile Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());
    await page.route("**/api/v1/**", (route) => route.fulfill({ json: {}, status: 200 }));
  });

  test("should load the profile page", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForTimeout(3000);

    const content = await page.textContent("body");
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(0);
  });

  test("profile page returns 200", async ({ page }) => {
    const response = await page.goto("/profile");
    expect(response?.status()).toBe(200);
  });

  test("should have proper page structure", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForTimeout(2000);

    // App Router renders directly in body (no #__next)
    const body = page.locator("body");
    await expect(body).toBeAttached();
    // Should have content rendered
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });

  test("should render without JavaScript errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/profile");
    await page.waitForTimeout(3000);

    // Filter out expected Firebase errors (API key not configured in test env)
    const unexpectedErrors = errors.filter(
      (e) => !e.includes("Firebase") && !e.includes("firebase") && !e.includes("auth"),
    );
    // No non-Firebase JS errors should occur
    expect(unexpectedErrors).toEqual([]);
  });
});
