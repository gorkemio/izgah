<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { startVisibilityPoller } from '#lib/client/visibility-poller.ts';
	import Bell from '@lucide/svelte/icons/bell';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { DURATION, duration } from '#lib/motion/index.ts';
	import type { NotificationFeedItem } from '#lib/server/interactions/service.ts';

	const POLL_INTERVAL_MS = 60_000;
	const VISIBILITY_MIN_ELAPSED_MS = 15_000;

	let unreadCount = $state(0);
	// The badge rolls to new counts (izgah-ui-v5.md §6, "Counters and badges").
	const badgeCount = Tween.of(() => unreadCount, {
		duration: () => duration(DURATION.slow),
		easing: cubicOut
	});
	let items = $state<NotificationFeedItem[]>([]);
	let loadError = $state(false);
	let markingAll = $state(false);
	let hasLoadedOnce = $state(false);
	let mutationEpoch = 0;

	const triggerLabel = $derived(
		unreadCount > 0 ? t('notif.labelUnread', { count: unreadCount }) : t('notif.label')
	);

	const formatTrRelativeOrDate = formatWhen;

	let open = $state(false);
	function close(): void {
		open = false;
	}

	async function fetchUnreadNotifications(): Promise<void> {
		const requestEpoch = mutationEpoch;
		try {
			const response = await fetch('/api/internal/notifications', {
				method: 'GET',
				headers: {
					Accept: 'application/json'
				}
			});
			if (!response.ok) {
				loadError = true;
				return;
			}
			const data = (await response.json()) as {
				unreadCount?: number;
				notifications?: NotificationFeedItem[];
			};
			if (requestEpoch !== mutationEpoch) {
				return;
			}
			unreadCount = typeof data.unreadCount === 'number' ? data.unreadCount : 0;
			items = Array.isArray(data.notifications) ? data.notifications : [];
			loadError = false;
			hasLoadedOnce = true;
		} catch {
			loadError = true;
		}
	}

	/** Returns false when the server did not confirm the change, so callers can roll back (F16). */
	async function markRead(
		payload: { notificationIds?: string[]; markAll?: boolean },
		options?: { keepalive?: boolean }
	): Promise<boolean> {
		mutationEpoch += 1;
		try {
			const response = await fetch('/api/internal/notifications', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify(payload),
				keepalive: options?.keepalive
			});
			if (!response.ok) {
				return false;
			}
			const data = (await response.json()) as {
				updatedCount?: number;
				unreadCount?: number;
			};
			if (typeof data.unreadCount === 'number') {
				unreadCount = data.unreadCount;
			}
			return true;
		} catch {
			return false;
		}
	}

	function handleNotificationClick(notificationId: string, close: () => void): void {
		items = items.filter((item) => item.id !== notificationId);
		unreadCount = Math.max(unreadCount - 1, 0);
		void markRead({ notificationIds: [notificationId] }, { keepalive: true });
		close();
	}

	async function handleMarkAllRead(): Promise<void> {
		if (markingAll || items.length === 0) {
			return;
		}
		markingAll = true;
		const previousItems = items;
		const previousUnreadCount = unreadCount;
		items = [];
		unreadCount = 0;

		const confirmed = await markRead({ markAll: true });
		if (!confirmed) {
			items = previousItems;
			unreadCount = previousUnreadCount;
		}
		markingAll = false;
	}

	$effect(() => {
		const poller = startVisibilityPoller({
			intervalMs: POLL_INTERVAL_MS,
			minElapsedOnVisibleMs: VISIBILITY_MIN_ELAPSED_MS,
			immediate: true,
			run: async () => {
				await fetchUnreadNotifications();
			}
		});
		return () => {
			poller.stop();
		};
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="notification-bell-trigger group/bell relative flex items-center gap-2.5 rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground max-md:size-9 max-md:justify-center md:min-h-8 md:w-full md:px-2.5 pointer-coarse:min-h-11 data-open:bg-sidebar-accent data-open:text-foreground"
		aria-label={triggerLabel}
	>
		<Bell class="size-[15px] shrink-0 max-md:size-[18px]" aria-hidden="true" />
		<span class="text-[13px] tracking-[-0.005em] max-md:sr-only">{t('notif.label')}</span>
		{#if unreadCount > 0}
			<span
				class="notification-badge ml-auto text-[11px] font-medium text-primary tabular-nums max-md:absolute max-md:top-1 max-md:right-1 max-md:grid max-md:min-w-4 max-md:place-items-center max-md:rounded-full max-md:bg-primary max-md:px-1 max-md:text-[10px] max-md:text-primary-foreground"
				aria-hidden="true"
			>
				{Math.round(badgeCount.current)}
			</span>
		{/if}
	</Popover.Trigger>
	<Popover.Content
		id="notification-bell-popover"
		side="right"
		align="start"
		sideOffset={10}
		collisionPadding={12}
		class="w-[340px] max-w-[calc(100vw-24px)] gap-0 rounded-xl border border-hairline p-0 shadow-lg ring-0"
	>
		<div class="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
			<h2 class="text-[14px] font-semibold tracking-[-0.01em]">{t('notif.label')}</h2>
			{#if items.length > 0}
				<button
					type="button"
					class="rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
					disabled={markingAll}
					onclick={handleMarkAllRead}
				>
					{t('notif.markAll')}
				</button>
			{/if}
		</div>

		{#if loadError}
			<p class="px-4 py-6 text-center text-[13px] text-muted-foreground" role="status">
				{t('notif.loadFailed')}
			</p>
		{:else if !hasLoadedOnce}
			<div class="grid gap-3 px-4 py-4" role="status">
				<span class="sr-only">{t('notif.loading')}</span>
				{#each [0, 1] as row (row)}
					<div class="grid gap-1.5" aria-hidden="true">
						<span class="h-3 w-4/5 animate-pulse rounded bg-muted"></span>
						<span class="h-2.5 w-1/2 animate-pulse rounded bg-muted"></span>
					</div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="px-4 py-8 text-center text-[13px] text-muted-foreground">{t('notif.empty')}</p>
		{:else}
			<ul class="max-h-[60dvh] overflow-y-auto p-1.5" role="list">
				{#each items as notif (notif.id)}
					<li>
						<a
							href="/resources/{notif.resourceId}"
							class="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-foreground no-underline transition-colors hover:bg-accent"
							onclick={() => handleNotificationClick(notif.id, close)}
						>
							<span class="text-[13px] leading-snug">{notif.message}</span>
							<span class="truncate text-[12px] text-muted-foreground">
								{notif.resourceTitle || notif.resourceDomain} ·
								<time datetime={notif.createdAt}>{formatTrRelativeOrDate(notif.createdAt)}</time>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</Popover.Content>
</Popover.Root>
