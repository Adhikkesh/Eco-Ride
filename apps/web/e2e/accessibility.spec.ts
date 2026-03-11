/**
 * E2E Tests – Accessibility & Performance
 *
 * Cross-cutting tests for responsive design, accessibility basics,
 * page load performance, and error handling across all pages.
 */

import { expect, test } from "./fixtures";

const PAGES = [
  { name: "Home", path: "/" },
  { name: "Dashboard", path: "/dashboard" },
  { name: "Onboarding", path: "/onboarding" },
  { name: "Rider", path: "/rider" },
  { name: "Driver", path: "/driver" },
  { name: "Profile", path: "/profile" },
  { name: "Admin Verification", path: "/Admin/verification" },
  { name: "Admin Analytics", path: "/Admin/analytics" },
];

test.describe("Accessibility & Page Health", () => {
  test.beforeEach(async ({ page }) => {
    // Block external calls for speed
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());
    await page.route("**/api/v1/**", (route) => route.fulfill({ json: {}, status: 200 }));
    await page.route("**/predict/**", (route) =>
      route.fulfill({ json: { predictions: [] }, status: 200 }),
    );
  });

  for (const { path, name } of PAGES) {
    test(`${name} page (${path}) should return HTTP 200`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
    });

    test(`${name} page (${path}) should have a <title>`, async ({ page }) => {
      await page.goto(path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test(`${name} page (${path}) should have a viewport meta tag`, async ({ page }) => {
      await page.goto(path);
      const viewport = page.locator('meta[name="viewport"]');
      await expect(viewport).toBeAttached();
    });

    test(`${name} page (${path}) should not have broken images`, async ({ page }) => {
      // Track failed image loads
      const failedImages: string[] = [];
      page.on("requestfailed", (req) => {
        if (req.resourceType() === "image") {
          failedImages.push(req.url());
        }
      });

      await page.goto(path);
      await page.waitForTimeout(2000);

      // Filter out external images we intentionally blocked
      const realFailures = failedImages.filter(
        (url) => !url.includes("googleapis") && !url.includes("firebase"),
      );
      expect(realFailures).toEqual([]);
    });
  }
});

test.describe("Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());
    await page.route("**/api/v1/**", (route) => route.fulfill({ json: {}, status: 200 }));
  });

  test("home page should render on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 }); // iPhone X
    await page.goto("/");
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });

  test("home page should render on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ height: 1024, width: 768 }); // iPad
    await page.goto("/");
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });

  test("home page should render on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ height: 1080, width: 1920 });
    await page.goto("/");
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });

  test("dashboard should render on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto("/dashboard");
    await page.waitForTimeout(2000);
    const content = await page.textContent("body");
    expect(content!.length).toBeGreaterThan(0);
  });
});

test.describe("Performance", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*.googleapis.com/**", (route) => route.abort());
    await page.route("**/*.firebaseio.com/**", (route) => route.abort());
    await page.route("**/*.firebaseapp.com/**", (route) => route.abort());
    await page.route("**/api/v1/**", (route) => route.fulfill({ json: {}, status: 200 }));
  });

  test("home page should load within 10 seconds", async ({ page }) => {
    const start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(10_000);
  });

  test("dashboard should load within 10 seconds", async ({ page }) => {
    const start = Date.now();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(10_000);
  });

  test("no console errors on home page (excluding Firebase)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      // Ignore Firebase-related errors since we're mocking
      if (
        !error.message.includes("Firebase") &&
        !error.message.includes("firebase") &&
        !error.message.includes("auth")
      ) {
        errors.push(error.message);
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
  });
});
