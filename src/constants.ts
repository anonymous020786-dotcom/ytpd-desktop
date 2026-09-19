// Fixed ports: NEXT_PUBLIC_API_URL is baked into the frontend at build time
// (see scripts/prepare-resources.mjs), so the backend port can't be chosen
// dynamically at runtime the way a normal server would.
export const BACKEND_PORT = 47391;
export const FRONTEND_PORT = 47392;
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
