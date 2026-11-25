import { eq } from 'drizzle-orm';
import { auth, clearSessionCookies } from '$lib/server/auth/better-auth';
import { db } from '$lib/server/db/client';
import { sessions } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		await auth.api.signOut({
			headers: event.request.headers,
			asResponse: true
		});
	} catch {
		// Session cookie may already be stale or revoked; ensure local cleanup proceeds.
	}

	if (event.locals.session?.id) {
		await db.delete(sessions).where(eq(sessions.id, event.locals.session.id));
	}

	clearSessionCookies(event.cookies);

	return new Response(null, {
		status: 303,
		headers: {
			Location: '/login',
			'Clear-Site-Data': '"cookies", "storage", "cache"',
			'Cache-Control': 'no-store'
		}
	});
};
