export type PollOutcome = 'ok' | 'stop' | 'backoff';

export interface VisibilityPollerOptions {
	/** Delay between polls while the tab is visible. */
	intervalMs: number;
	/** When the tab becomes visible again, poll immediately only if this much time has passed. */
	minElapsedOnVisibleMs: number;
	/** Poll once right away when started on a visible tab. */
	immediate: boolean;
	/** Upper bound for exponential backoff after `'backoff'` outcomes. */
	maxBackoffMs?: number;
	run: () => Promise<PollOutcome | void>;
}

export interface VisibilityPoller {
	stop(): void;
	/** Poll now (e.g. after a user action), then continue on the normal schedule. */
	trigger(): void;
}

/**
 * Visibility-aware polling shared by the notification bell and the new-posts pill
 * (docs/designs/izgah-core.md §6 / izgah-ui-v2.md §8.5): never polls hidden tabs, re-checks on
 * return when enough time has passed, and stops or backs off as the callback asks.
 */
export function startVisibilityPoller(options: VisibilityPollerOptions): VisibilityPoller {
	let stopped = false;
	let timerId: ReturnType<typeof setTimeout> | null = null;
	let lastRunAt = 0;
	let currentDelay = options.intervalMs;
	const maxBackoff = options.maxBackoffMs ?? 5 * 60_000;

	const isVisible = () => document.visibilityState === 'visible';

	const clearTimer = () => {
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
	};

	const arm = (delayMs: number) => {
		clearTimer();
		if (stopped || !isVisible()) {
			return;
		}
		timerId = setTimeout(
			() => {
				timerId = null;
				void runAndReschedule();
			},
			Math.max(delayMs, 0)
		);
	};

	async function runAndReschedule(): Promise<void> {
		if (stopped || !isVisible()) {
			return;
		}
		lastRunAt = Date.now();
		let outcome: PollOutcome | void;
		try {
			outcome = await options.run();
		} catch {
			outcome = 'backoff';
		}
		if (stopped) {
			return;
		}
		if (outcome === 'stop') {
			stop();
			return;
		}
		currentDelay =
			outcome === 'backoff' ? Math.min(currentDelay * 2, maxBackoff) : options.intervalMs;
		arm(currentDelay);
	}

	const handleVisibilityChange = () => {
		if (!isVisible()) {
			clearTimer();
			return;
		}
		const elapsed = lastRunAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastRunAt;
		if (elapsed >= options.minElapsedOnVisibleMs) {
			void runAndReschedule();
		} else {
			arm(Math.max(currentDelay - elapsed, options.minElapsedOnVisibleMs - elapsed));
		}
	};

	function stop(): void {
		stopped = true;
		clearTimer();
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	}

	document.addEventListener('visibilitychange', handleVisibilityChange);
	if (isVisible()) {
		if (options.immediate) {
			void runAndReschedule();
		} else {
			lastRunAt = Date.now();
			arm(options.intervalMs);
		}
	}

	return {
		stop,
		trigger() {
			if (!stopped) {
				void runAndReschedule();
			}
		}
	};
}
