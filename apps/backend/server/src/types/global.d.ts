/**
 * @fileoverview Express Global Type Augmentations
 * @description Extends the Express `Request` interface with a `user` property
 *              populated by the `verifyToken` authentication middleware.
 *              This makes `req.user` available across all route handlers.
 * @module types/global
 */

import type { DecodedIdToken } from "firebase-admin/auth";

declare global {
  namespace Express {
    /** Augmented Express Request carrying the decoded Firebase ID token. */
    interface Request {
      /** Decoded Firebase ID token set by the `verifyToken` middleware. */
      user?: DecodedIdToken;
    }
  }
}
