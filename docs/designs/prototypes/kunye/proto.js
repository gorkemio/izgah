// Prototype controls (not part of the design): theme, font and wordmark variant, kept in the URL
// so every page and screenshot can be reproduced. Add `shot=1` to hide this panel.
const root = document.documentElement;
const params = new URLSearchParams(window.location.search);
const state = {
	theme: params.get('theme') ?? 'auto',
	font: params.get('font') ?? 'a',
	mark: params.get('mark') ?? '1'
};

function apply() {
	if (state.theme === 'auto') {
		delete root.dataset.theme;
	} else {
		root.dataset.theme = state.theme;
	}
	root.dataset.font = state.font;
	root.dataset.mark = state.mark;
	if (params.has('shot')) {
		root.dataset.shot = '';
	}

	const query = new URLSearchParams(state).toString();
	window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
	for (const link of document.querySelectorAll('a[data-proto]')) {
		const url = new URL(link.href);
		url.search = query;
		link.href = url.toString();
	}
	for (const control of document.querySelectorAll('select[data-proto-control]')) {
		control.value = state[control.name];
	}
}

document.addEventListener('change', (event) => {
	const control = event.target;
	if (control instanceof HTMLSelectElement && control.dataset.protoControl !== undefined) {
		state[control.name] = control.value;
		apply();
	}
});

apply();
