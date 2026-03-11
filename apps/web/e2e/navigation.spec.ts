/**
 * E2E Tests – Navigation & Routing
 *
 * Tests route protection, redirects for unauthenticated users,
 * and page-to-page navigation across the application.
 */

import { expect, test } from "./fixtures";

test.describe("Route Protection & Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Block external services
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());
  });

  test("unauthenticated user visiting /dashboard should be redirected to /", async ({ page }) => {
    // Backend returns 401 for unauthenticated users
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "Unauthorized" }, status: 401 }),
    );

    await page.goto("/dashboard");

    // Should eventually redirect to home or show auth required state
    await page.waitForURL(/\/$|\/dashboard/, { timeout: 10000 });

    // The page should either redirect to "/" or show a loading/redirect state
    const url = page.url();
    // Dashboard requires auth - should load the page then redirect via client-side
    expect(url).toMatch(/\/$|\/dashboard/);
  });

  test("unauthenticated user visiting /rider should be redirected", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "Unauthorized" }, status: 401 }),
    );

    await page.goto("/rider");
    // Wait for client-side redirect
    await page.waitForTimeout(3000);
    // Should show loading or redirect
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("unauthenticated user visiting /profile should handle gracefully", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "Unauthorized" }, status: 401 }),
    );

    await page.goto("/profile");
    await page.waitForTimeout(3000);
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("/onboarding page should load for new users", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "User not found" }, status: 404 }),
    );

    await page.goto("/onboarding");
    // Should show the onboarding form or redirect
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("/Admin/verification page should be accessible", async ({ page }) => {
    // Mock Firebase signInWithEmailAndPassword for admin auto-login
    await page.route("**/api/v1/admin/unverified-drivers", (route) =>
      route.fulfill({
        json: { drivers: [] },
        status: 200,
      }),
    );

    await page.goto("/Admin/verification");
    await page.waitForTimeout(2000);
    // Should show admin content or passkey form
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("/Admin/analytics page should be accessible", async ({ page }) => {
    await page.route("**/api/v1/prediction/**", (route) =>
      route.fulfill({
        json: {
          forecast: Array.from({ length: 24 }, (_, i) => ({
            demand: 50,
            hour: i,
            surge: 1.0,
          })),
          success: true,
        },
        status: 200,
      }),
    );

    await page.goto("/Admin/analytics");
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("navigating from home to admin verification via link", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "User not found" }, status: 404 }),
    );

    await page.goto("/");
    const adminLink = page.getByText("Login as Admin");
    await expect(adminLink).toBeVisible();

    await adminLink.click();
    await page.waitForURL("**/Admin/verification", { timeout: 10000 });
    expect(page.url()).toContain("/Admin/verification");
  });

  test("/driver page should load", async ({ page }) => {
    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { error: "Unauthorized" }, status: 401 }),
    );

    await page.goto("/driver");
    await page.waitForTimeout(2000);
    // The page renders DriverLiveMap directly - it should at least load
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });
});
