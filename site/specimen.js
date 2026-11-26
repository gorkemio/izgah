// The izgah.com specimen behaves like the app's feed (docs/designs/izgah-ui-v4.md §4, §6): j and k
// move the selection, Space opens the selected entry's discussion, Like and the section suggestion
// answer. Without this script the specimen still reads as plain HTML and the discussions open on
// click. Texts come from the page, so the English and Turkish pages share the script.
document.documentElement.classList.add('js');

const specimen = document.querySelector('[data-specimen]');

if (specimen) {
	const entries = [...specimen.querySelectorAll('.share-card')];
	let current = Math.max(
		0,
		entries.findIndex((entry) => entry.getAttribute('aria-current') === 'true')
	);

	const select = (index, focus) => {
		current = Math.min(entries.length - 1, Math.max(0, index));
		entries.forEach((entry, i) => {
			if (i === current) {
				entry.setAttribute('aria-current', 'true');
			} else {
				entry.removeAttribute('aria-current');
			}
		});
		if (focus) {
			entries[current].focus();
		}
	};

	entries.forEach((entry, index) => {
		entry.tabIndex = -1;
		entry.addEventListener('focusin', () => select(index, false));
		entry.addEventListener('click', (event) => {
			if (!event.target.closest('a, button, summary')) {
				select(index, true);
			}
		});
	});

	specimen.addEventListener('keydown', (event) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input')) {
			return;
		}
		if (event.key === 'j' || event.key === 'k') {
			event.preventDefault();
			select(current + (event.key === 'j' ? 1 : -1), true);
		} else if (event.key === ' ' && !event.target.closest('button, summary')) {
			const thread = entries[current]?.querySelector('details');
			if (thread) {
				event.preventDefault();
				thread.open = !thread.open;
			}
		}
	});

	for (const button of specimen.querySelectorAll('[data-like]')) {
		button.hidden = false;
		button.setAttribute('aria-pressed', 'false');
		button.addEventListener('click', () => {
			button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
		});
	}

	const suggestion = specimen.querySelector('[data-suggestion]');
	if (suggestion) {
		const add = suggestion.querySelector('[data-suggestion-add]');
		const dismiss = suggestion.querySelector('[data-suggestion-dismiss]');
		add.hidden = false;
		dismiss.hidden = false;
		add.addEventListener('click', () => {
			const chip = suggestion.querySelector('.section-chip');
			suggestion.closest('.card-body').querySelector('.kunye').append(chip);
			suggestion.remove();
		});
		dismiss.addEventListener('click', () => suggestion.remove());
	}
}
