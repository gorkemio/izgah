import type { RequestHandler } from './$types';
import {
	apiJson,
	apiPreflight,
	createApiRequestLogger,
	getRequestId,
	requireApiV1User
} from '#lib/server/api/response.ts';

export const OPTIONS: RequestHandler = async (event) => {
	return apiPreflight(getRequestId(event));
};

export const GET: RequestHandler = async (event) => {
	const auth = requireApiV1User(event);
	if (!auth.ok) {
		return auth.response;
	}

	const { log, clientName } = createApiRequestLogger(event);
	log.info('Fetched API v1 current user', clientName ? { client_name: clientName } : undefined);

	const { id, name, email, role } = auth.user;
	return apiJson(
		{
			user: { id, name, email, role }
		},
		getRequestId(event)
	);
};
