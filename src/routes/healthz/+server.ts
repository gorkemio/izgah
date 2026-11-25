import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json(
		{ status: 'ok' },
		{
			status: 200,
			headers: {
				'Cache-Control': 'no-store'
			}
		}
	);
};
