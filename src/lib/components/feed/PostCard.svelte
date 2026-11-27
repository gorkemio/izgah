<script module lang="ts">
	export type { FeedShareAttribution, FeedShareItem, ShareCardFormError } from '#lib/types/feed.ts';
</script>

<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { formatDate, formatDateTime, formatShortDate, formatTime } from '#lib/format/date.ts';
	import { freshShare } from '#lib/client/fresh-share.svelte.ts';
	import { restoreShare } from '#lib/client/restore-share.ts';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import Dialog from '#lib/components/legacy/Dialog.svelte';
	import Highlight from '#lib/components/ui/Highlight.svelte';
	import PopoverPanel from '#lib/components/legacy/PopoverPanel.svelte';
	import type { SectionListItem } from '#lib/server/sections/service.ts';
	import type { ContentType } from '#lib/types/domain.ts';
	import type { FeedShareItem as PostItem } from '#lib/types/feed.ts';
	import { kunyeCase, resourceFacts } from '#lib/format/kunye.ts';
	import LikeButton from './LikeButton.svelte';
	import LinkAttachment from './LinkAttachment.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';
	import ShareSuggestions from './ShareSuggestions.svelte';

	interface Props {
		item: PostItem;
		sections: SectionListItem[];
		currentUserId: string;
		isAdmin: boolean;
		actionBase: string;
		returnTo: string;
		priorityImage?: boolean;
		/** Called after a successful delete so pages can drop the card from locally appended pages. */
		onDeleted?: (shareId: string) => void;
		/** Desktop side-peek handler; JS-off or mobile follows the `<a href="/resources/{id}">` link. */
		onPreview?: (item: PostItem) => void;
		/** Newer than the viewer's last visit (izgah-ui-v2 §8.4). */
		unseen?: boolean;
		/** Shown in the reading pane: the entry takes the selected-row surface (izgah-ui-v4 §4). */
		selected?: boolean;
		/** Search terms to mark in the note and the link attachment (/search). */
		highlightTerms?: readonly string[];
		/**
		 * Resource page timeline: the resource, its likes and comments are already on the page, so
		 * the attachment, attribution and resource actions are left out.
		 */
		compact?: boolean;
	}

	let {
		item,
		sections,
		currentUserId,
		isAdmin,
		actionBase,
		returnTo,
		priorityImage = false,
		onDeleted,
		onPreview,
		unseen = false,
		selected = false,
		highlightTerms = [],
		compact = false
	}: Props = $props();

	// Feed pages depend on app:feed and /search on app:search, so an edit or delete refreshes the
	// list it happened in without re-running searches on every feed refresh (C2).
	function refreshLists(): Promise<unknown> {
		return Promise.all([invalidate('app:feed'), invalidate('app:search')]);
	}

	let articleEl = $state<HTMLElement | null>(null);
	let editDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);

	let editNote = $state('');
	let editSectionIds = $state<string[]>([]);
	let editContentType = $state<ContentType>('web');
	let editSilentMode = $state(false);
	let editSubmitting = $state(false);
	let editErrorMessage = $state<string | null>(null);
	let editFieldErrors = $state<Record<string, string[]>>({});

	let deleteSubmitting = $state(false);
	let deleteErrorMessage = $state<string | null>(null);

	const isOwner = $derived(currentUserId === item.author.id);
	const canManage = $derived(isOwner || isAdmin);

	const cardTitleId = $derived(`share-${item.id}-title`);
	const authorId = $derived(`share-${item.id}-author`);
	const noteId = $derived(`share-${item.id}-note`);
	const cardLabel = $derived(item.resource.title || item.resource.domain);
	const isPendingUnfurl = $derived(
		item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'
	);

	// The link's own facts, in künye order: site · type · language · stars · author.
	const metaParts = $derived(resourceFacts(item.resource));

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(item.rawUrl);
			toasts.push(t('link.copied'), { tone: 'success' });
		} catch {
			toasts.push(t('link.copyFailed'), { tone: 'error' });
		}
	}

	let noteEl = $state<HTMLElement | null>(null);
	let noteOverflows = $state(false);
	let noteExpanded = $state(false);

	// "Show more" only when the clamped note actually overflows (JS-off users see it in full).
	$effect(() => {
		if (!noteEl) {
			return;
		}
		void item.note;
		noteOverflows = noteEl.scrollHeight > noteEl.clientHeight + 1;
	});

	const editTitleId = $derived(`share-edit-title-${item.id}`);
	const deleteTitleId = $derived(`share-delete-title-${item.id}`);
	const editNoteId = $derived(`share-edit-note-${item.id}`);
	const editTypeId = $derived(`share-edit-type-${item.id}`);

	const initialSectionIds = $derived(item.sections.map((section) => section.id));
	const initialSilentMode = $derived(!item.isFeedVisible);

	function sameIdSet(a: string[], b: string[]): boolean {
		if (a.length !== b.length) {
			return false;
		}
		const left = [...a].sort();
		const right = [...b].sort();
		return left.every((val, index) => val === right[index]);
	}

	const editDirty = $derived(
		(isOwner && editNote !== (item.note ?? '')) ||
			!sameIdSet(editSectionIds, initialSectionIds) ||
			editContentType !== item.resource.contentType ||
			(isAdmin && editSilentMode !== initialSilentMode)
	);

	function syncEditFormFromItem(): void {
		editNote = item.note ?? '';
		editSectionIds = [...initialSectionIds];
		editContentType = item.resource.contentType;
		editSilentMode = initialSilentMode;
		editSubmitting = false;
		editErrorMessage = null;
		editFieldErrors = {};
	}

	function openEditDialog(): void {
		syncEditFormFromItem();
		editDialogOpen = true;
	}

	function openDeleteDialog(): void {
		deleteSubmitting = false;
		deleteErrorMessage = null;
		deleteDialogOpen = true;
	}

	function toggleEditSection(sectionId: string, checked: boolean): void {
		if (checked) {
			if (!editSectionIds.includes(sectionId)) {
				editSectionIds = [...editSectionIds, sectionId];
			}
		} else {
			editSectionIds = editSectionIds.filter((id) => id !== sectionId);
		}
	}

	function handlePreviewClick(event: MouseEvent): void {
		if (
			!onPreview ||
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		if (!window.matchMedia('(min-width: 1024px)').matches) {
			return;
		}
		event.preventDefault();
		onPreview(item);
	}

	const handleEditEnhance: SubmitFunction = ({ cancel }) => {
		editErrorMessage = null;
		editFieldErrors = {};

		if (isAdmin && editSilentMode && editSectionIds.length === 0) {
			editErrorMessage = t('share.silentNeedsSection');
			editFieldErrors = { sectionIds: [t('share.silentNeedsSection')] };
			cancel();
			return;
		}

		editSubmitting = true;

		return async ({ result }) => {
			editSubmitting = false;

			if (result.type === 'failure') {
				const data = result.data as
					| {
							errorMessage?: string;
							fieldErrors?: Record<string, string[]>;
					  }
					| undefined;
				editErrorMessage = data?.errorMessage ?? t('share.updateFailed');
				editFieldErrors = data?.fieldErrors ?? {};
				return;
			}

			if (result.type === 'error') {
				editErrorMessage = t('share.updateUnexpected');
				return;
			}

			if (result.type === 'redirect') {
				editDialogOpen = false;
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				editDialogOpen = false;
				await refreshLists();
			}
		};
	};

	function markCardForViewTransition(): void {
		if (
			typeof document === 'undefined' ||
			typeof document.startViewTransition !== 'function' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
			!articleEl
		) {
			return;
		}
		for (const stale of document.querySelectorAll<HTMLElement>('[data-vt-card]')) {
			stale.style.removeProperty('view-transition-name');
			stale.removeAttribute('data-vt-card');
		}
		articleEl.setAttribute('data-vt-card', 'true');
		articleEl.style.viewTransitionName = 'active-resource-card';
		// The thumbnail morphs into the resource page's cover (izgah-ui-v5.md §6).
		const cover = articleEl.querySelector<HTMLElement>('.card-thumbnail-frame');
		if (cover) {
			cover.setAttribute('data-vt-card', 'true');
			cover.style.viewTransitionName = `resource-cover-${item.resource.id}`;
		}
	}

	const handleDeleteEnhance: SubmitFunction = () => {
		deleteErrorMessage = null;
		deleteSubmitting = true;

		return async ({ result }) => {
			deleteSubmitting = false;

			if (result.type === 'failure') {
				const data = result.data as { errorMessage?: string } | undefined;
				deleteErrorMessage = data?.errorMessage ?? t('share.deleteFailed');
				return;
			}

			if (result.type === 'error') {
				deleteErrorMessage = t('share.deleteUnexpected');
				return;
			}

			if (result.type === 'redirect') {
				deleteDialogOpen = false;
				offerUndo(item.id);
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				deleteDialogOpen = false;
				onDeleted?.(item.id);
				offerUndo(item.id);
				await refreshLists();
			}
		};
	};

	/** "Share deleted · Undo" for 30 seconds' worth of regret (izgah-ui-v5.md §10.3). */
	function offerUndo(shareId: string) {
		toasts.push(t('share.deletedToast'), {
			tone: 'success',
			action: {
				label: t('share.restore'),
				onClick: async () => {
					const outcome = await restoreShare(shareId);
					if (outcome.ok) {
						toasts.push(t('share.restored'), { tone: 'success' });
						await invalidateAll();
					} else {
						toasts.push(outcome.message, { tone: 'error' });
					}
				}
			}
		});
	}
</script>

<div class="share-card-container">
	<article
		bind:this={articleEl}
		id="share-{item.id}"
		class="share-card group/entry relative rounded-xl border bg-card p-4 shadow-sm transition-colors outline-none focus-visible:halo {selected
			? 'border-[color-mix(in_oklab,var(--primary)_45%,transparent)]'
			: 'border-hairline hover:border-[color-mix(in_oklab,var(--foreground)_16%,transparent)]'}"
		class:is-unseen={unseen}
		class:is-fresh={freshShare.id === item.id}
		class:is-compact={compact}
		tabindex="-1"
		aria-current={selected ? 'true' : undefined}
		aria-labelledby={compact ? authorId : `${authorId} ${cardTitleId}`}
		data-share-id={item.id}
		data-post
		data-url={item.rawUrl}
		data-resource-id={item.resource.id}
	>
		<header class="post-head flex min-w-0 items-center gap-2.5">
			<MemberAvatar
				id={item.author.id}
				name={item.author.name}
				avatarAssetKey={item.author.avatarAssetKey}
			/>
			<p class="min-w-0 truncate text-[13px] leading-tight">
				<strong id={authorId} class="post-author font-medium">{item.author.name}</strong>
				<span class="text-muted-foreground">
					<span aria-hidden="true">&ensp;</span>
					<a
						class="post-time text-muted-foreground tabular-nums no-underline hover:text-foreground hover:underline"
						href="/resources/{item.resource.id}#share-{item.id}"
						title={formatDateTime(item.createdAt)}
						onclick={markCardForViewTransition}
					>
						<span class="sr-only">
							{t('share.sharedAt', { date: formatDate(item.createdAt) })}
						</span>
						<time datetime={item.createdAt}>{formatTime(item.createdAt)}</time>
					</a>
				</span>
			</p>
			{#if unseen}
				<span
					class="unseen-pill inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-primary"
				>
					<span class="size-1.5 rounded-full bg-primary" aria-hidden="true"></span>
					{t('share.new')}
				</span>
			{/if}
			{#if !compact}
				<div
					class="card-menu-wrap ml-auto opacity-0 transition-opacity group-focus-within/entry:opacity-100 group-hover/entry:opacity-100 group-aria-[current=true]/entry:opacity-100 pointer-coarse:opacity-100"
				>
					<PopoverPanel
						triggerLabel={t('share.actions')}
						iconOnly
						triggerClass="card-menu-trigger grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						{#snippet trigger()}
							<Ellipsis class="size-4" aria-hidden="true" />
						{/snippet}
						{#snippet children({ close })}
							<div class="card-menu-list grid min-w-40 gap-px p-1">
								{#if onPreview}
									<a
										href="/resources/{item.resource.id}"
										class="card-menu-item"
										aria-label={t('share.peekLabel', { title: cardLabel })}
										data-shortcut="peek"
										onclick={(event) => {
											close();
											handlePreviewClick(event);
										}}
									>
										{t('share.peek')}
									</a>
								{/if}
								<button
									type="button"
									class="card-menu-item"
									onclick={() => {
										close();
										void copyLink();
									}}
								>
									{t('share.copyShort')}
								</button>
								{#if canManage}
									<button
										type="button"
										class="card-menu-item"
										onclick={() => {
											close();
											openEditDialog();
										}}
									>
										{t('common.edit')}
									</button>
									<button
										type="button"
										class="card-menu-item is-danger"
										onclick={() => {
											close();
											openDeleteDialog();
										}}
									>
										{t('common.delete')}
									</button>
								{/if}
							</div>
						{/snippet}
					</PopoverPanel>
				</div>
			{/if}
		</header>

		<div class="post-body">
			{#if item.note}
				<div class="post-note-wrap mt-2.5">
					<p
						bind:this={noteEl}
						id={noteId}
						class="post-note card-note text-[15px] leading-[1.55] tracking-[-0.006em] text-pretty"
						class:line-clamp-6={!noteExpanded}
					>
						<Highlight text={item.note} terms={highlightTerms} />
					</p>
					{#if noteOverflows || noteExpanded}
						<button
							type="button"
							class="note-toggle mt-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
							aria-expanded={noteExpanded}
							aria-controls={noteId}
							onclick={() => {
								noteExpanded = !noteExpanded;
							}}
						>
							{noteExpanded ? t('share.showLess') : t('share.showMore')}
						</button>
					{/if}
				</div>
			{/if}

			{#if compact}
				{#if item.sections.length > 0}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each item.sections as section (section.id)}
							<a href="/sections/{section.slug}" class="section-chip">{section.name}</a>
						{/each}
					</div>
				{/if}
			{:else}
				<LinkAttachment {item} titleId={cardTitleId} {priorityImage} {highlightTerms}>
					{#snippet kunye()}
						<!-- The facts line in künye order; empty fields are left out (izgah-ui-v5 §5.1). -->
						<div
							class="kunye flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground"
						>
							{#each metaParts as part, index (index)}
								{#if index > 0}<span class="opacity-50" aria-hidden="true">·</span>{/if}
								<span>{part}</span>
							{/each}
							{#if item.attribution}
								<span class="opacity-50" aria-hidden="true">·</span>
								{#if item.attribution.kind === 'original-deleted'}
									<span class="attribution-notice is-deleted">{t('share.originalDeleted')}</span>
								{:else}
									<a
										class="attribution-notice text-muted-foreground no-underline hover:text-foreground hover:underline"
										href="/resources/{item.resource.id}#share-{item.attribution.shareId}"
									>
										{t('share.firstShort', {
											name: item.attribution.authorName,
											date: formatShortDate(item.attribution.createdAt)
										})}
									</a>
								{/if}
							{/if}
							{#if !item.isFeedVisible}
								<span class="opacity-50" aria-hidden="true">·</span>
								<span class="badge-silent">{kunyeCase(t('share.silent'))}</span>
							{/if}
							{#if isPendingUnfurl}
								<span class="opacity-50" aria-hidden="true">·</span>
								<span class="badge-pending animate-pulse">
									{kunyeCase(t('share.previewPending'))}
								</span>
							{:else if item.resource.unfurlStatus === 'failed'}
								<span class="opacity-50" aria-hidden="true">·</span>
								<span class="badge-failed text-destructive">{t('share.previewFailed')}</span>
							{/if}
						</div>
					{/snippet}
				</LinkAttachment>

				{#if item.sections.length > 0}
					<div class="mt-2.5 flex flex-wrap gap-1.5">
						{#each item.sections as section (section.id)}
							<a href="/sections/{section.slug}" class="section-chip">{section.name}</a>
						{/each}
					</div>
				{/if}

				<div class="card-actions mt-2.5 -ml-2 flex flex-wrap items-center gap-0.5 text-[12.5px]">
					<a
						href="/resources/{item.resource.id}#comments"
						class="card-discussion-link card-action"
						aria-label={item.resource.commentCount > 0
							? t('comment.countLabel', {
									count: item.resource.commentCount,
									title: cardLabel
								})
							: t('comment.writeLabel', { title: cardLabel })}
						data-shortcut="comments"
						onclick={markCardForViewTransition}
					>
						<MessageCircle class="size-[15px]" aria-hidden="true" />
						<span class="tabular-nums">
							{item.resource.commentCount > 0 ? item.resource.commentCount : t('comment.write')}
						</span>
					</a>
					<LikeButton {item} {actionBase} {returnTo} />
					<a
						href={item.rawUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="card-action"
						aria-label={t('share.openLabel', { title: cardLabel })}
					>
						<ExternalLink class="size-[15px]" aria-hidden="true" />
						<span class="max-sm:sr-only">{t('share.open')}</span>
					</a>
					<button
						type="button"
						class="card-action"
						aria-label={t('share.copyLabel', { title: cardLabel })}
						onclick={() => void copyLink()}
					>
						<Copy class="size-[15px]" aria-hidden="true" />
						<span class="max-sm:sr-only">{t('share.copyShort')}</span>
					</button>
				</div>

				{#if item.suggestions?.length}
					<ShareSuggestions
						shareId={item.id}
						suggestions={item.suggestions}
						{actionBase}
						{returnTo}
					/>
				{/if}
			{/if}
		</div>
	</article>

	{#if canManage}
		<Dialog
			bind:open={editDialogOpen}
			id="edit-share-dialog-{item.id}"
			titleId={editTitleId}
			dirty={editDirty}
			guardUnsaved={true}
			closedby="closerequest"
			onDiscard={syncEditFormFromItem}
		>
			{#snippet children({ requestClose })}
				<header class="dialog-header">
					<h3 id={editTitleId} class="dialog-title">{t('share.editTitle')}</h3>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						aria-label={t('share.closeEdit')}
						onclick={() => requestClose('cancel')}
					>
						{t('common.close')}
					</button>
				</header>

				{#if editErrorMessage}
					<div class="panel-error" role="alert">{editErrorMessage}</div>
				{/if}

				<form
					method="POST"
					action="{actionBase}?/updateShare"
					use:enhance={handleEditEnhance}
					class="panel-form"
				>
					<input type="hidden" name="shareId" value={item.id} />
					<input type="hidden" name="returnTo" value={returnTo} />
					<input type="hidden" name="previousContentType" value={item.resource.contentType} />

					{#if isOwner}
						<div class="field">
							<label for="{editNoteId}-modal" class="field-label">{t('share.note')}</label>
							<textarea
								id="{editNoteId}-modal"
								name="note"
								rows="3"
								maxlength="1000"
								value={editNote}
								oninput={(e) => {
									editNote = e.currentTarget.value;
								}}
								aria-invalid={Boolean(editFieldErrors.note?.length) || undefined}
								class="textarea textarea-input"></textarea>
							{#if editFieldErrors.note?.length}
								<p class="field-error">{editFieldErrors.note[0]}</p>
							{/if}
						</div>
					{:else if item.note}
						<p class="readonly-note">{t('share.readonlyNote', { note: item.note })}</p>
					{/if}

					<fieldset class="sections-fieldset">
						<legend class="field-label">
							{t('share.sections')}
							{isAdmin && editSilentMode ? t('share.sectionsRequired') : ''}
						</legend>
						{#if sections.length === 0}
							<p class="field-hint">{t('share.noSections')}</p>
						{:else}
							<div class="sections-grid">
								{#each sections as section (section.id)}
									<label class="checkbox-row">
										<input
											type="checkbox"
											name="sectionIds"
											value={section.id}
											checked={editSectionIds.includes(section.id)}
											onchange={(e) => toggleEditSection(section.id, e.currentTarget.checked)}
										/>
										<span>{section.name}</span>
									</label>
								{/each}
							</div>
						{/if}
						{#if editFieldErrors.sectionIds?.length}
							<p class="field-error">{editFieldErrors.sectionIds[0]}</p>
						{/if}
					</fieldset>

					<div class="field">
						<label for="{editTypeId}-modal" class="field-label">{t('share.contentType')}</label>
						<select
							id="{editTypeId}-modal"
							name="contentType"
							value={editContentType}
							onchange={(e) => {
								editContentType = e.currentTarget.value as ContentType;
							}}
							class="select"
						>
							<option value="article">{t('contentType.article')}</option>
							<option value="video">{t('contentType.video')}</option>
							<option value="repo">{t('contentType.repo')}</option>
							<option value="social">{t('contentType.social')}</option>
							<option value="web">{t('contentType.web')}</option>
						</select>
						{#if editFieldErrors.contentType?.length}
							<p class="field-error">{editFieldErrors.contentType[0]}</p>
						{/if}
					</div>

					{#if isAdmin}
						<label class="checkbox-row silent-checkbox">
							<input
								type="checkbox"
								name="silentMode"
								value="true"
								checked={editSilentMode}
								onchange={(e) => {
									editSilentMode = e.currentTarget.checked;
								}}
							/>
							<span>{t('share.silentOption')}</span>
						</label>
					{/if}

					<div class="panel-actions">
						<button type="button" class="btn btn-outline" onclick={() => requestClose('cancel')}>
							{t('common.cancel')}
						</button>
						<button type="submit" class="btn btn-primary" disabled={editSubmitting}>
							{editSubmitting ? t('common.saving') : t('share.saveChanges')}
						</button>
					</div>
				</form>
			{/snippet}
		</Dialog>

		<Dialog
			bind:open={deleteDialogOpen}
			id="delete-share-dialog-{item.id}"
			titleId={deleteTitleId}
			closedby="closerequest"
		>
			{#snippet children({ closeNow })}
				<h3 id={deleteTitleId} class="dialog-title">{t('share.deleteTitle')}</h3>
				{#if deleteErrorMessage}
					<div class="panel-error" role="alert">{deleteErrorMessage}</div>
				{/if}
				<p class="delete-confirm-text">
					{t('share.deleteConfirm', { title: item.resource.title || item.rawUrl })}
				</p>
				<div class="panel-actions">
					<!-- svelte-ignore a11y_autofocus -->
					<button
						type="button"
						class="btn btn-outline"
						autofocus
						onclick={() => closeNow('cancel')}
					>
						{t('common.cancel')}
					</button>

					<form method="POST" action="{actionBase}?/deleteShare" use:enhance={handleDeleteEnhance}>
						<input type="hidden" name="shareId" value={item.id} />
						<input type="hidden" name="returnTo" value={returnTo} />
						<button type="submit" class="btn btn-danger" disabled={deleteSubmitting}>
							{deleteSubmitting ? t('common.deleting') : t('share.deleteTitle')}
						</button>
					</form>
				</div>
			{/snippet}
		</Dialog>
	{/if}
</div>

<style>
	/* The viewer's own new share briefly takes the accent border (izgah-ui-v5.md §6). */
	.share-card.is-fresh {
		animation: izgah-fresh 2.4s cubic-bezier(0.2, 0, 0, 1) both;
	}

	@keyframes izgah-fresh {
		from {
			border-color: var(--primary);
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 25%, transparent);
		}
	}

	/* Feed entry (izgah-ui-v5.md §5.1). Most styling is in Tailwind classes above; these rules cover
	   the shared action, chip and menu items and the edit and delete dialogs. */
	.share-card :global(.card-action) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: 28px;
		padding: 0 8px;
		border-radius: var(--radius-md);
		color: var(--muted-foreground);
		text-decoration: none;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.share-card :global(.card-action:hover) {
		background: var(--accent);
		color: var(--foreground);
	}

	.section-chip {
		display: inline-flex;
		align-items: center;
		min-block-size: 22px;
		padding: 0 8px;
		border: 1px solid var(--hairline);
		border-radius: 9999px;
		font-size: 12px;
		color: var(--muted-foreground);
		text-decoration: none;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.section-chip:hover {
		color: var(--foreground);
		border-color: color-mix(in oklab, var(--foreground) 20%, transparent);
	}

	.card-menu-item {
		display: flex;
		align-items: center;
		inline-size: 100%;
		min-block-size: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		font-size: 13px;
		color: var(--foreground);
		text-align: start;
		text-decoration: none;
		cursor: pointer;
	}

	.card-menu-item:hover {
		background: var(--accent);
	}

	.card-menu-item.is-danger {
		color: var(--destructive);
	}

	.dialog-title {
		margin: 0 0 var(--space-3);
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--foreground);
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-3);
	}

	.dialog-header .dialog-title {
		margin: 0;
	}

	.panel-error {
		margin-block-end: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in oklab, var(--destructive) 35%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		font-size: 13px;
	}

	.panel-form {
		display: grid;
		gap: var(--space-4);
	}

	.textarea-input {
		min-block-size: 4.5rem;
		max-block-size: 14rem;
		block-size: auto;
		field-sizing: content;
	}

	.readonly-note {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--muted);
		font-size: 13px;
		color: var(--muted-foreground);
	}

	.sections-fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.sections-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0 var(--space-4);
		margin-block-start: var(--space-1);
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 34px;
		font-size: 13px;
		color: var(--foreground);
		cursor: pointer;
	}

	.sections-grid .checkbox-row:has(input:checked) {
		font-weight: 600;
	}

	.checkbox-row input[type='checkbox'] {
		inline-size: 1rem;
		block-size: 1rem;
		flex-shrink: 0;
		accent-color: var(--primary);
	}

	.silent-checkbox {
		padding: var(--space-2) 0 0;
		border-block-start: 1px solid var(--hairline);
	}

	.delete-confirm-text {
		margin: 0 0 var(--space-4);
		font-size: 14px;
		color: var(--muted-foreground);
	}

	.panel-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	@media (forced-colors: active) {
		.share-card {
			border-color: CanvasText;
		}
	}

	@media (pointer: coarse) {
		.checkbox-row,
		.share-card :global(.card-action) {
			min-block-size: 44px;
		}
	}
</style>
