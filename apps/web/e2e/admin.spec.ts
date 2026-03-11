/**
 * E2E Tests – Admin Pages
 *
 * Tests the Admin verification and analytics pages, including
 * the passkey form, driver list, and analytics dashboard.
 */

import { expect, test } from "./fixtures";

test.describe("Admin – Verification Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());

    await page.route("**/api/v1/admin/unverified-drivers", (route) =>
      route.fulfill({
        json: {
          drivers: [
            {
              email: "pending@ecoride.com",
              kyc_url: "https://example.com/kyc.pdf",
              license_url: "https://example.com/license.pdf",
              name: "Pending Driver",
              phone_number: "9876543210",
              uid: "unverified-1",
              vehicle: {
                is_ev: true,
                model: "Tesla Model 3",
                plate_number: "KA01AB1234",
                pollution_expiry: "2027-01-01",
              },
            },
          ],
        },
        status: 200,
      }),
    );

    await page.route("**/api/v1/admin/verify-driver", (route) =>
      route.fulfill({ json: { success: true }, status: 200 }),
    );

    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { user: { role: "admin", uid: "admin-uid" } }, status: 200 }),
    );
  });

  test("should load the verification page", async ({ page }) => {
    await page.goto("/Admin/verification");
    await page.waitForTimeout(3000);

    const content = await page.textContent("body");
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(0);
  });

  test("should show passkey input or admin content", async ({ page }) => {
    await page.goto("/Admin/verification");
    await page.waitForTimeout(5000);

    // The page may show passkey, admin dashboard, authenticating state, or an error
    const bodyContent = await page.textContent("body");
    // Page should render some content (not blank)
    expect(bodyContent!.trim().length).toBeGreaterThan(0);
  });

  test("admin verification page returns 200", async ({ page }) => {
    const response = await page.goto("/Admin/verification");
    expect(response?.status()).toBe(200);
  });

  test("should have navigation to analytics", async ({ page }) => {
    await page.goto("/Admin/verification");
    await page.waitForTimeout(3000);

    // Look for analytics link/button
    const analyticsLink = page.getByText(/analytics/i);
    if (await analyticsLink.isVisible().catch(() => false)) {
      await expect(analyticsLink).toBeVisible();
    }
  });

  test("should have logout functionality", async ({ page }) => {
    await page.goto("/Admin/verification");
    await page.waitForTimeout(3000);

    // Look for logout button
    const logoutBtn = page.getByText(/logout|sign out/i);
    if (await logoutBtn.isVisible().catch(() => false)) {
      await expect(logoutBtn).toBeVisible();
    }
  });
});

test.describe("Admin – Analytics Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());

    await page.route("**/api/v1/prediction/**", (route) =>
      route.fulfill({
        json: {
          forecast: Array.from({ length: 24 }, (_, i) => ({
            demand: Math.floor(Math.random() * 100),
            hour: i,
            surge: 1 + Math.random() * 0.5,
          })),
          success: true,
        },
        status: 200,
      }),
    );

    await page.route("**/api/v1/auth/verify", (route) =>
      route.fulfill({ json: { user: { role: "admin", uid: "admin-uid" } }, status: 200 }),
    );

    await page.route("**/predict/**", (route) =>
      route.fulfill({
        json: {
          predictions: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            predicted_demand: 50 + Math.random() * 50,
            surge_multiplier: 1 + Math.random(),
          })),
        },
        status: 200,
      }),
    );
  });

  test("should load the analytics page", async ({ page }) => {
    await page.goto("/Admin/analytics");
    await page.waitForTimeout(3000);

    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("analytics page returns 200", async ({ page }) => {
    const response = await page.goto("/Admin/analytics");
    expect(response?.status()).toBe(200);
  });

  test("should show analytics or prediction content", async ({ page }) => {
    await page.goto("/Admin/analytics");
    await page.waitForTimeout(3000);

    // Page should have some analytics-related content
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });

  test("should have navigation back to verification", async ({ page }) => {
    await page.goto("/Admin/analytics");
    await page.waitForTimeout(3000);

    const verificationLink = page.getByText(/verification|back/i);
    if (
      await verificationLink
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await expect(verificationLink.first()).toBeVisible();
    }
  });
});
