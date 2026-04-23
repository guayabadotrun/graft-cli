// Production Guayaba API base URL. This is a property of @guayaba/graft-cli
// itself, not of the user — every CLI install talks to the same backend.
// If this ever needs to change, bump the package and ship a new version;
// don't add a flag.
//
// Note: this points to the Public API v1 surface (master-key auth). The
// Sanctum-protected `/api` endpoints are for the manager UI only.
export const API_BASE_URL = process.env.GUAYABA_API_BASE_URL ?? 'https://api.guayaba.run/api/v1';
