<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { startVisibilityPoller } from '#lib/client/visibility-poller.ts';
	import PopoverPanel from '#lib/components/ui/PopoverPanel.svelte';
	import type { NotificationFeedItem } from '#lib/server/interactions/service.ts';

	const POLL_INTERVAL_MS = 60_000;
	const VISIBILITY_MIN_ELAPSED_MS = 15_000;

	let unreadCount = $state(0);
	let items = $state<NotificationFeedItem[]>([]);
	let loadError = $state(false);
	let markingAll = $state(false);
	let hasLoadedOnce = $state(false);
	let mutationEpoch = 0;

	const triggerLabel = $derived(
		unreadCount > 0 ? t('notif.labelUnread', { count: unreadCount }) : t('notif.label')
	);

	const formatTrRelativeOrDate = formatWhen;

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

<div class="notification-bell-wrap">
	<PopoverPanel
		id="notification-bell-popover"
		{triggerLabel}
		iconOnly={true}
		triggerClass="notification-bell-trigger"
		panelClass="notification-bell-panel"
	>
		{#snippet trigger()}
			<span class="bell-trigger-content">
				<span class="bell-label">{t('notif.label')}</span>
				{#if unreadCount > 0}
					<span class="notification-badge" aria-hidden="true">{unreadCount}</span>
				{/if}
			</span>
		{/snippet}

		{#snippet children({ close })}
			<div class="notif-panel-inner">
				<div class="notif-panel-header">
					<h2 class="notif-panel-title">{t('notif.label')}</h2>
					{#if items.length > 0}
						<button
							type="button"
							class="btn btn-subtle btn-sm notif-mark-all-btn"
							disabled={markingAll}
							onclick={handleMarkAllRead}
						>
							{t('notif.markAll')}
						</button>
					{/if}
				</div>

				{#if loadError}
					<p class="notif-empty" role="status">{t('notif.loadFailed')}</p>
				{:else if !hasLoadedOnce}
					<div class="notif-skeleton" role="status">
						<span class="visually-hidden">{t('notif.loading')}</span>
						<div class="notif-skeleton-row" aria-hidden="true">
							<span class="skeleton skeleton-line notif-skeleton-primary"></span>
							<span class="skeleton skeleton-line notif-skeleton-secondary"></span>
						</div>
						<div class="notif-skeleton-row" aria-hidden="true">
							<span class="skeleton skeleton-line notif-skeleton-primary"></span>
							<span class="skeleton skeleton-line notif-skeleton-secondary"></span>
						</div>
					</div>
				{:else if items.length === 0}
					<p class="notif-empty">{t('notif.empty')}</p>
				{:else}
					<ul class="notif-list" role="list">
						{#each items as notif (notif.id)}
							<li class="notif-list-item">
								<a
									href="/resources/{notif.resourceId}"
									class="notif-item-link"
									onclick={() => handleNotificationClick(notif.id, close)}
								>
									<span class="notif-item-body">
										<span class="notif-item-message">{notif.message}</span>
										<span class="notif-item-meta">
											{notif.resourceTitle || notif.resourceDomain} ·
											<time datetime={notif.createdAt}>
												{formatTrRelativeOrDate(notif.createdAt)}
											</time>
										</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/snippet}
	</PopoverPanel>
</div>

<style>
	.notification-bell-wrap {
		position: relative;
		flex-shrink: 0;
	}

	:global(.notification-bell-trigger) {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 9px;
		inline-size: calc(100% + 16px);
		min-block-size: 32px;
		margin-inline: -8px;
		padding: 5px 8px;
		font: var(--text-ui);
		font-size: 0.9375rem;
		font-weight: 400;
		color: var(--color-text-secondary);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	:global(.notification-bell-trigger:hover) {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	:global(.notification-bell-trigger:active) {
		opacity: 0.88;
	}

	/* A word, not a bell (izgah-ui-v4 §1); the unread count is a link-blue figure after it. */
	.bell-trigger-content {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		inline-size: 100%;
	}

	.notification-badge {
		margin-inline-start: auto;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-link);
	}

	@media (max-width: 767px) {
		:global(.notification-bell-trigger) {
			inline-size: auto;
			margin-inline: 0;
		}
	}

	:global(.notification-bell-panel) {
		inline-size: min(22.5rem, calc(100dvw - 2 * var(--gutter)));
		padding: var(--space-3);
	}

	.notif-panel-inner {
		display: grid;
		gap: var(--space-3);
	}

	.notif-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-block-end: var(--space-2);
		border-block-end: 1px solid var(--color-line);
	}

	.notif-panel-title {
		margin: 0;
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.notif-mark-all-btn {
		min-block-size: 28px;
		padding: 0 var(--space-2);
		font-size: 0.78125rem;
		white-space: nowrap;
	}

	.notif-empty {
		margin: 0;
		padding: var(--space-3) 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.notif-skeleton {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-1) 0;
	}

	.notif-skeleton-row {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
	}

	.notif-skeleton-primary {
		inline-size: 88%;
	}

	.notif-skeleton-secondary {
		inline-size: 56%;
		block-size: 0.75em;
	}

	.notif-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		max-block-size: 20rem;
		overflow-y: auto;
	}

	.notif-item-link {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text);
		border: 1px solid transparent;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.notif-item-link:hover {
		background: var(--color-surface-2);
		border-color: var(--color-line);
		color: var(--color-text);
		text-decoration: none;
	}

	.notif-item-link:active {
		opacity: 0.88;
	}

	.notif-item-body {
		display: grid;
		gap: 3px;
		min-inline-size: 0;
	}

	.notif-item-message {
		font: var(--text-ui);
		font-weight: 500;
		color: var(--color-text);
	}

	.notif-item-meta {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	@media (prefers-reduced-motion: no-preference) {
		:global(.notification-bell-trigger) {
			transition:
				background-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease);
		}
	}

	@media (pointer: coarse) {
		.notif-mark-all-btn {
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		:global(.notification-bell-trigger:active),
		.notif-item-link:active {
			opacity: 1;
		}

		.notification-badge {
			color: LinkText;
		}
	}
</style>
