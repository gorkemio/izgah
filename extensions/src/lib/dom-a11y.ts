export type ValidatableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface PoliteAnnouncer {
	announce(message: string, delayMs?: number): void;
	clear(): void;
	dispose(): void;
}

/**
 * Manages a single polite live region, alternating trailing NBSP for repeated announcements
 * and optionally delaying blur-time field announcements so they do not collide with focus changes.
 */
export function createPoliteAnnouncer(liveRegionEl: HTMLElement): PoliteAnnouncer {
	let lastMessage = '';
	let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

	function clearTimer() {
		if (timer !== null) {
			globalThis.clearTimeout(timer);
			timer = null;
		}
	}

	return {
		announce(message, delayMs = 0) {
			const trimmed = message.trim();
			clearTimer();
			if (trimmed === '') {
				liveRegionEl.textContent = '';
				return;
			}

			let nextText = trimmed;
			if (nextText === lastMessage) {
				nextText = `${nextText}\u00A0`;
			}
			lastMessage = nextText;
			liveRegionEl.textContent = '';

			if (delayMs > 0) {
				timer = globalThis.setTimeout(() => {
					timer = null;
					liveRegionEl.textContent = nextText;
				}, delayMs);
				return;
			}

			liveRegionEl.textContent = nextText;
		},

		clear() {
			clearTimer();
			liveRegionEl.textContent = '';
		},

		dispose() {
			clearTimer();
		}
	};
}

/**
 * Convenience helper for one-shot announcements in a polite live region.
 */
export function announcePolite(liveRegionEl: HTMLElement, message: string): void {
	liveRegionEl.textContent = '';
	liveRegionEl.textContent = message.trim();
}

/**
 * Synchronizes aria-invalid, custom validity, error visibility, and conditional aria-describedby.
 * Never lists the error element id while valid, preventing premature announcements on focus.
 */
export function syncFieldErrorState(
	control: ValidatableControl,
	errorMessage: string | null
): void {
	const errorId = control.dataset.error?.trim() ?? '';
	const hintId = control.dataset.hint?.trim() ?? '';
	const trimmedError = errorMessage?.trim() ?? '';
	const isInvalid = trimmedError !== '';

	control.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
	control.classList.toggle('user-invalid-fallback', isInvalid);
	if (typeof control.setCustomValidity === 'function') {
		control.setCustomValidity(isInvalid ? trimmedError : '');
	}

	const describedByIds: string[] = [];
	if (hintId !== '') {
		describedByIds.push(hintId);
	}
	if (isInvalid && errorId !== '') {
		describedByIds.push(errorId);
	}

	if (describedByIds.length > 0) {
		control.setAttribute('aria-describedby', describedByIds.join(' '));
	} else {
		control.removeAttribute('aria-describedby');
	}

	if (errorId !== '') {
		const errorEl = control.ownerDocument.getElementById(errorId);
		if (errorEl) {
			errorEl.textContent = trimmedError;
			errorEl.hidden = !isInvalid;
		}
	}
}

export interface PostInteractionFieldConfig {
	control: ValidatableControl;
	validate: () => string | null;
}

export interface PostInteractionValidator {
	validateAllAndFocusFirst(): boolean;
	setServerFieldError(control: ValidatableControl, errorMessage: string): void;
	resetValidation(): void;
	dispose(): void;
}

interface FieldInteractionState {
	edited: boolean;
	blurred: boolean;
}

/**
 * Binds post-interaction form validation: silent on page load and focus, validating on blur
 * after edit, clearing errors as the user fixes them on input, and focusing the first error on submit.
 */
export function bindPostInteractionValidation(
	fields: readonly PostInteractionFieldConfig[],
	announcer?: PoliteAnnouncer
): PostInteractionValidator {
	const states = new WeakMap<ValidatableControl, FieldInteractionState>();
	const cleanups: Array<() => void> = [];

	function resetField(control: ValidatableControl) {
		states.set(control, { edited: false, blurred: false });
		syncFieldErrorState(control, null);
	}

	for (const { control, validate } of fields) {
		resetField(control);

		const onInputOrChange = () => {
			const current = states.get(control) ?? { edited: false, blurred: false };
			current.edited = true;
			states.set(control, current);

			// Clear existing error state as soon as input becomes valid; avoid nagging while valid->editing
			if (control.getAttribute('aria-invalid') === 'true') {
				if (typeof control.setCustomValidity === 'function') {
					control.setCustomValidity('');
				}
				const errMsg = validate();
				if (!errMsg) {
					syncFieldErrorState(control, null);
				} else if (current.blurred) {
					syncFieldErrorState(control, errMsg);
				}
			}
		};

		const onBlur = () => {
			const current = states.get(control) ?? { edited: false, blurred: false };
			if (!current.edited && control.getAttribute('aria-invalid') !== 'true') {
				return;
			}
			current.blurred = true;
			states.set(control, current);

			if (typeof control.setCustomValidity === 'function') {
				control.setCustomValidity('');
			}
			const errMsg = validate();
			syncFieldErrorState(control, errMsg);
			if (errMsg && announcer) {
				const labelText = control.labels?.[0]?.textContent?.trim() ?? '';
				announcer.announce(labelText ? `${labelText}: ${errMsg}` : errMsg, 500);
			}
		};

		control.addEventListener('input', onInputOrChange);
		control.addEventListener('change', onInputOrChange);
		control.addEventListener('blur', onBlur);

		cleanups.push(() => {
			control.removeEventListener('input', onInputOrChange);
			control.removeEventListener('change', onInputOrChange);
			control.removeEventListener('blur', onBlur);
		});
	}

	return {
		validateAllAndFocusFirst() {
			let firstInvalid: ValidatableControl | null = null;
			for (const { control, validate } of fields) {
				states.set(control, { edited: true, blurred: true });
				if (typeof control.setCustomValidity === 'function') {
					control.setCustomValidity('');
				}
				const errMsg = validate();
				syncFieldErrorState(control, errMsg);
				if (errMsg && firstInvalid === null) {
					firstInvalid = control;
				}
			}

			if (firstInvalid) {
				firstInvalid.focus();
				return false;
			}
			return true;
		},

		setServerFieldError(control, errorMessage) {
			states.set(control, { edited: true, blurred: true });
			syncFieldErrorState(control, errorMessage);
		},

		resetValidation() {
			for (const { control } of fields) {
				resetField(control);
			}
		},

		dispose() {
			for (const cleanup of cleanups) {
				cleanup();
			}
		}
	};
}

export interface ErrorBannerElements {
	bannerEl: HTMLElement;
	messageEl: HTMLElement;
	requestIdRowEl?: HTMLElement | null;
	requestIdCodeEl?: HTMLElement | null;
}

/**
 * Renders or clears a localized error banner strictly using textContent (never innerHTML).
 */
export function setTextErrorBanner(
	elements: ErrorBannerElements,
	error: { message: string; requestId?: string | null } | null
): void {
	const { bannerEl, messageEl, requestIdRowEl, requestIdCodeEl } = elements;
	if (!error) {
		bannerEl.hidden = true;
		messageEl.textContent = '';
		if (requestIdRowEl) {
			requestIdRowEl.hidden = true;
		}
		if (requestIdCodeEl) {
			requestIdCodeEl.textContent = '';
		}
		return;
	}

	messageEl.textContent = error.message;
	const requestId = error.requestId?.trim() ?? '';
	if (requestIdCodeEl && requestIdRowEl) {
		requestIdCodeEl.textContent = requestId;
		requestIdRowEl.hidden = requestId === '';
	}
	bannerEl.hidden = false;
}

export interface ImeCompositionTracker {
	lastCompositionEndAt: number | null;
	onCompositionEnd(event: CompositionEvent): void;
}

/**
 * Tracks browser compositionend dispatch timestamps to avoid Safari IME submission ordering races.
 */
export function createImeTracker(): ImeCompositionTracker {
	const tracker: ImeCompositionTracker = {
		lastCompositionEndAt: null,
		onCompositionEnd(event: CompositionEvent) {
			tracker.lastCompositionEndAt = event.timeStamp;
		}
	};
	return tracker;
}

/**
 * Checks whether a keydown event is an IME-safe Cmd/Ctrl+Enter submit shortcut.
 */
export function isImeSafeSubmitShortcut(
	event: KeyboardEvent,
	tracker?: Pick<ImeCompositionTracker, 'lastCompositionEndAt'>
): boolean {
	if (event.key !== 'Enter') {
		return false;
	}
	if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
		return false;
	}
	if (event.isComposing || event.keyCode === 229) {
		return false;
	}
	if (
		tracker?.lastCompositionEndAt !== null &&
		tracker?.lastCompositionEndAt !== undefined &&
		Math.abs(event.timeStamp - tracker.lastCompositionEndAt) < 50
	) {
		return false;
	}
	return true;
}
