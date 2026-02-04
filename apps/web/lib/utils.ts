/**
 * @fileoverview Utility Functions
 * @description Common utility functions used across the web application.
 *              Provides class name merging with Tailwind CSS conflict resolution.
 * @module lib/utils
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind CSS conflict resolution.
 * @description Combines multiple class values using clsx and resolves
 *              Tailwind CSS class conflicts using twMerge.
 *              Use this instead of plain string concatenation for className props.
 * @param {...ClassValue} inputs - Class values to merge (strings, arrays, objects)
 * @returns {string} Merged and de-duped class string
 * @example
 * cn("px-4 py-2", "px-6") // Returns "px-6 py-2" (px-6 overrides px-4)
 * cn("text-red-500", { "text-blue-500": isBlue }) // Conditional classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
