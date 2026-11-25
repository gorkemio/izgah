import { auth, toSvelteKitHandler } from '#lib/server/auth/better-auth.ts';

const handler = toSvelteKitHandler(auth);

export const GET = handler;
export const POST = handler;
