interface HeaderSettingEvent {
	request: Request;
	setHeaders: (headers: Record<string, string>) => void;
}

const headersSetPerRequest = new WeakMap<Request, Set<string>>();

/**
 * Idempotent wrapper around SvelteKit's `setHeaders`.
 *
 * SvelteKit throws `"<name>" header is already set` when the same header is set twice during one
 * request. A non-enhanced form POST runs the action and then the page `load` in the same request,
 * so an action and a load that both set `Cache-Control` (or `Retry-After`) would turn a validation
 * failure or a 429 into a 500. Headers already set for this request are skipped.
 */
export function setHeadersOnce(event: HeaderSettingEvent, headers: Record<string, string>): void {
	let alreadySet = headersSetPerRequest.get(event.request);
	if (!alreadySet) {
		alreadySet = new Set<string>();
		headersSetPerRequest.set(event.request, alreadySet);
	}

	const pending: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		const lower = name.toLowerCase();
		if (alreadySet.has(lower)) {
			continue;
		}
		alreadySet.add(lower);
		pending[name] = value;
	}

	if (Object.keys(pending).length > 0) {
		event.setHeaders(pending);
	}
}
