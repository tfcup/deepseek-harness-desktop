//! Compatibility helpers for assertions against the Harness-generated HTML shell.

const BOOT_ASSIGNMENT =
  /(?:window|globalThis)(?:\.__DSH_BOOT__|\[\s*["']__DSH_BOOT__["']\s*\])\s*=\s*(\{.*?\})\s*<\/script>/s;

/** Extract the serialized boot graph across the property syntaxes used by Harness releases. */
export function extractDshBootJson(html: string): string | null {
  return BOOT_ASSIGNMENT.exec(html)?.[1] ?? null;
}
