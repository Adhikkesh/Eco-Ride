# Stripe Integration & Testing Guide

I have integrated Stripe payment flow into your Eco-Ride project. Here is how to configure and test it.

## 1. Get Stripe API Keys (Test Mode)

1.  Log in to your [Stripe Dashboard](https://dashboard.stripe.com/).
2.  Toggle the **"Test Mode"** switch at the top right to **ON**.
3.  Go to **Developers** > **API keys**.
4.  Copy the **Publishable key** (starts with `pk_test_...`).
5.  Copy the **Secret key** (starts with `sk_test_...`).

## 2. Configure Environment Variables

You need to add these keys to your project environment files.

### Server (`apps/server/.env`)
Add your **Secret Key**:
```env
STRIPE_SECRET_KEY=sk_test_...
```

### Web (`apps/web/.env.local`)
Add your **Publishable Key**:
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```
*(If `.env.local` doesn't exist, create it or add to `.env`)*

## 3. Restart Servers
Since we installed new packages and changed env vars, you must restart your servers.

1.  Stop the current servers (Ctrl+C).
2.  Run:
    ```bash
    pnpm dev
    ```

## 4. How to Test the Flow

1.  **Login as Rider**: Go to `/rider` (or login from home).
2.  **Request a Ride**:
    *   Select a destination.
    *   Click "Get Price Estimate".
    *   Click "Confirm Ride".
3.  **Simulate Driver** (in a separate window/incognito):
    *   Login as a driver.
    *   Go to `/driver`.
    *   You should see the ride request. **Accept** it.
    *   Enter the OTP (shown on rider screen).
    *   Click "Start Trip".
    *   Wait a moment, then click **"Complete Trip"**.
4.  **Verify Payment Popup**:
    *   Switch back to the **Rider Window**.
    *   Automatically, a **"Trip Completed"** modal will appear with the payment form.
5.  **Enter Test Payment Details**:
    Use Stripe's test card numbers:
    *   **Card Number**: `4242 4242 4242 4242`
    *   **Expiry**: Any future date (e.g., `12/30`)
    *   **CVC**: Any 3 digits (e.g., `123`)
    *   **ZIP**: Any valid zip (e.g., `12345`)
6.  Click **"Pay Securely"**.
7.  You should see a success message, and the ride state will reset.

## Troubleshooting
- **"Error initializing payment"**: Check if your `STRIPE_SECRET_KEY` is correct in `apps/server/.env`.
- **Popup doesn't appear**: Ensure the driver clicked "Complete Trip" and the rider page is still open and connected (Live indicator is green).
