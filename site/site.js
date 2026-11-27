// izgah.com: the Copy button on the install commands. The page reads fine without this script; the
// button stays hidden until the Clipboard API is available. Its labels live in the page, so the
// English and Turkish pages share the script.
for (const button of document.querySelectorAll('[data-copy]')) {
	const source = document.querySelector(button.dataset.copy);
	if (!source || !navigator.clipboard) continue;
	button.hidden = false;
	let timer;
	button.addEventListener('click', async () => {
		const text = [...source.childNodes]
			.filter((node) => !(node instanceof Element && node.classList.contains('c')))
			.map((node) => node.textContent)
			.join('')
			.trim();
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return;
		}
		button.dataset.copied = '';
		clearTimeout(timer);
		timer = setTimeout(() => delete button.dataset.copied, 2000);
	});
}
