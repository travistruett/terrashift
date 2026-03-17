// Bump this when regenerating textures to bust browser + CDN cache.
// The value is appended as ?v=N to all texture URLs.
export const TEXTURE_VERSION = 1;

// CDN base URL for heavy textures (Cloudflare R2).
// Empty string in dev → loads from /public via Next.js dev server.
export const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL ?? "";
