import type { RequestHandler } from './$types';
import {
	apiJson,
	apiPreflight,
	createApiRequestLogger,
	getRequestId,
	handleApiV1Error,
	requireApiV1User
} from '#lib/server/api/response.ts';
import { listSections } from '#lib/server/sections/service.ts';

export const OPTIONS: RequestHandler = async (event) => {
	return apiPreflight(getRequestId(event));
};

export const GET: RequestHandler = async (event) => {
	const auth = requireApiV1User(event);
	if (!auth.ok) {
		return auth.response;
	}

	try {
		const sectionsList = await listSections();
		const { log, clientName } = createApiRequestLogger(event);
		log.info('Listed sections via API v1', {
			section_count: sectionsList.length,
			...(clientName ? { client_name: clientName } : {})
		});

		return apiJson({ sections: sectionsList }, getRequestId(event));
	} catch (error) {
		return handleApiV1Error(error, event);
	}
};
