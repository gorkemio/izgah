<script module lang="ts">
	export type { FeedShareAttribution, FeedShareItem, ShareCardFormError } from '#lib/types/feed.ts';
</script>

<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { formatDate, formatDateTime, formatTime } from '#lib/format/date.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Highlight from '#lib/components/ui/Highlight.svelte';
	import PopoverPanel from '#lib/components/ui/PopoverPanel.svelte';
	import type { SectionListItem } from '#lib/server/sections/service.ts';
	import type { ContentType } from '#lib/types/domain.ts';
	import type {
		FeedShareItem as PostItem,
		ShareCardFormError as PostFormError
	} from '#lib/types/feed.ts';
	import LinkAttachment from './LinkAttachment.svelte';
	import PostActions from './PostActions.svelte';
	import ShareSuggestions from './ShareSuggestions.svelte';

	interface Props {
		item: PostItem;
		sections: SectionListItem[];
		currentUserId: string;
		isAdmin: boolean;
		actionBase: string;
		returnTo: string;
		priorityImage?: boolean;
		activeEditShareId?: string | null;
		activeDeleteShareId?: string | null;
		activeFormError?: PostFormError | null;
		/** Called after a successful delete so pages can drop the card from locally appended pages. */
		onDeleted?: (shareId: string) => void;
		/** Desktop side-peek handler; JS-off or mobile follows the `<a href="/resources/{id}">` link. */
		onPreview?: (item: PostItem) => void;
		/** Newer than the viewer's last visit (izgah-ui-v2 §8.4). */
		unseen?: boolean;
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
		activeEditShareId = null,
		activeDeleteShareId = null,
		activeFormError = null,
		onDeleted,
		onPreview,
		unseen = false,
		highlightTerms = [],
		compact = false
	}: Props = $props();

	let hydrated = $state(false);

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

	$effect(() => {
		hydrated = true;
	});

	const isOwner = $derived(currentUserId === item.author.id);
	const canManage = $derived(isOwner || isAdmin);

	const cardTitleId = $derived(`share-${item.id}-title`);
	const authorId = $derived(`share-${item.id}-author`);
	const noteId = $derived(`share-${item.id}-note`);
	const cardLabel = $derived(item.resource.title || item.resource.domain);

	let noteEl = $state<HTMLElement | null>(null);
	let noteOverflows = $state(false);
	let noteExpanded = $state(false);

	// "Devamını göster" only when the clamped note actually overflows (JS-off users see it in full).
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

	function buildQueryActionHref(param: 'edit' | 'delete'): string {
		const [pathname, query = ''] = returnTo.split('?');
		const params = new URLSearchParams(query);
		params.delete('compose');
		params.delete('edit');
		params.delete('delete');
		params.set(param, item.id);
		const encoded = params.toString();
		return encoded ? `${pathname}?${encoded}` : pathname;
	}

	const editHref = $derived(buildQueryActionHref('edit'));
	const deleteHref = $derived(buildQueryActionHref('delete'));
	const isInlineEditFallback = $derived(
		!hydrated &&
			canManage &&
			(activeEditShareId === item.id ||
				(activeFormError?.formType === 'updateShare' && activeFormError.shareId === item.id))
	);
	const isInlineDeleteFallback = $derived(
		!hydrated &&
			canManage &&
			(activeDeleteShareId === item.id ||
				(activeFormError?.formType === 'deleteShare' && activeFormError.shareId === item.id))
	);
	const inlineEditError = $derived(
		activeFormError?.formType === 'updateShare' && activeFormError.shareId === item.id
			? activeFormError
			: null
	);
	const inlineDeleteError = $derived(
		activeFormError?.formType === 'deleteShare' && activeFormError.shareId === item.id
			? activeFormError
			: null
	);

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
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				deleteDialogOpen = false;
				onDeleted?.(item.id);
				await refreshLists();
			}
		};
	};
</script>

<div class="share-card-container">
	<article
		bind:this={articleEl}
		id="share-{item.id}"
		class="share-card"
		class:is-unseen={unseen}
		class:is-compact={compact}
		tabindex="-1"
		aria-labelledby={compact ? authorId : `${authorId} ${cardTitleId}`}
		data-share-id={item.id}
		data-post
		data-url={item.rawUrl}
		data-resource-id={item.resource.id}
	>
		<header class="post-head">
			<a
				class="post-time"
				href="/resources/{item.resource.id}#share-{item.id}"
				title={formatDateTime(item.createdAt)}
			>
				<span class="visually-hidden">
					{t('share.sharedAt', { date: formatDate(item.createdAt) })}
				</span>
				<time datetime={item.createdAt}>{formatTime(item.createdAt)}</time>
			</a>
			<strong id={authorId} class="post-author">{item.author.name}</strong>
			{#if unseen}
				<span class="unseen-pill">{t('share.new')}</span>
			{/if}
			{#if (!compact && onPreview) || canManage}
				<div class="post-head-tools">
					{#if !compact && onPreview}
						<!-- A plain word without a hover hint (ui-v4 §1: words instead of icons). -->
						<a
							href="/resources/{item.resource.id}"
							class="tag preview-trigger"
							aria-label={t('share.peekLabel', { title: cardLabel })}
							onclick={handlePreviewClick}
						>
							<span>{t('share.peek')}</span>
						</a>
					{/if}

					{#if canManage}
						<div class="card-menu-wrap">
							<PopoverPanel
								triggerLabel={t('share.actions')}
								iconOnly
								triggerClass="card-menu-trigger"
							>
								{#snippet trigger()}
									<span>{t('share.actionsShort')}</span>
								{/snippet}
								{#snippet children({ close })}
									<div class="card-menu-list">
										{#if hydrated}
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
										{:else}
											<a href={editHref} class="card-menu-item">{t('common.edit')}</a>
											<a href={deleteHref} class="card-menu-item is-danger">{t('common.delete')}</a>
										{/if}
									</div>
								{/snippet}
							</PopoverPanel>
						</div>
					{/if}
				</div>
			{/if}
		</header>

		<div class="post-body">
			{#if item.note}
				<div class="post-note-wrap">
					<p
						bind:this={noteEl}
						id={noteId}
						class="post-note card-note"
						class:is-expanded={noteExpanded}
					>
						<Highlight text={item.note} terms={highlightTerms} />
					</p>
					{#if noteOverflows || noteExpanded}
						<button
							type="button"
							class="note-toggle"
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

			{#if compact && item.sections.length > 0}
				<p class="post-tags">
					{#each item.sections as section (section.id)}
						<a href="/sections/{section.slug}" class="section-chip">{section.name}</a>
					{/each}
				</p>
			{/if}

			{#if !compact}
				<LinkAttachment {item} titleId={cardTitleId} {priorityImage} {highlightTerms} />

				{#if item.sections.length > 0 || !item.isFeedVisible || item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'}
					<p class="post-tags">
						{#each item.sections as section (section.id)}
							<a href="/sections/{section.slug}" class="section-chip">{section.name}</a>
						{/each}
						{#if !item.isFeedVisible}
							<span class="badge-silent">{t('share.silent')}</span>
						{/if}
						{#if item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'}
							<span class="badge-pending">{t('share.previewPending')}</span>
						{/if}
					</p>
				{/if}

				{#if item.suggestions?.length}
					<ShareSuggestions
						shareId={item.id}
						suggestions={item.suggestions}
						{actionBase}
						{returnTo}
					/>
				{/if}

				<PostActions {item} {actionBase} {returnTo} onOpenDiscussion={markCardForViewTransition} />
			{/if}
		</div>
	</article>

	{#if isInlineEditFallback}
		<section class="inline-card-panel" aria-labelledby={editTitleId}>
			<h4 id={editTitleId} class="panel-heading">{t('share.editTitle')}</h4>
			{#if inlineEditError?.errorMessage}
				<div class="panel-error" role="alert">{inlineEditError.errorMessage}</div>
			{/if}
			<form method="POST" action="{actionBase}?/updateShare" class="panel-form">
				<input type="hidden" name="shareId" value={item.id} />
				<input type="hidden" name="returnTo" value={returnTo} />
				<input type="hidden" name="previousContentType" value={item.resource.contentType} />

				{#if isOwner}
					<div class="field">
						<label for={editNoteId} class="field-label">{t('share.note')}</label>
						<textarea
							id={editNoteId}
							name="note"
							rows="3"
							maxlength="1000"
							value={inlineEditError?.values?.note ?? item.note ?? ''}
							class="textarea textarea-input"></textarea>
					</div>
				{:else if item.note}
					<p class="readonly-note">{t('share.readonlyNote', { note: item.note })}</p>
				{/if}

				<fieldset class="sections-fieldset">
					<legend class="field-label">{t('share.sections')}</legend>
					<div class="sections-grid">
						{#each sections as section (section.id)}
							{@const fallbackSectionIds = inlineEditError?.values?.sectionIds ?? initialSectionIds}
							<label class="checkbox-row">
								<input
									type="checkbox"
									name="sectionIds"
									value={section.id}
									checked={fallbackSectionIds.includes(section.id)}
								/>
								<span>{section.name}</span>
							</label>
						{/each}
					</div>
					{#if inlineEditError?.fieldErrors?.sectionIds?.length}
						<p class="field-error">{inlineEditError.fieldErrors.sectionIds[0]}</p>
					{/if}
				</fieldset>

				<div class="field">
					<label for={editTypeId} class="field-label">{t('share.contentType')}</label>
					<select
						id={editTypeId}
						name="contentType"
						value={inlineEditError?.values?.contentType ?? item.resource.contentType}
						class="select"
					>
						<option value="article">{t('contentType.article')}</option>
						<option value="video">{t('contentType.video')}</option>
						<option value="repo">{t('contentType.repo')}</option>
						<option value="social">{t('contentType.social')}</option>
						<option value="web">{t('contentType.web')}</option>
					</select>
				</div>

				{#if isAdmin}
					{@const fallbackSilent = inlineEditError?.values?.silentMode ?? initialSilentMode}
					<label class="checkbox-row silent-checkbox">
						<input type="checkbox" name="silentMode" value="true" checked={fallbackSilent} />
						<span>{t('share.silentOption')}</span>
					</label>
				{/if}

				<div class="panel-actions">
					<a href={returnTo} class="btn btn-outline">{t('common.cancel')}</a>
					<button type="submit" class="btn btn-primary">{t('share.saveChanges')}</button>
				</div>
			</form>
		</section>
	{/if}

	{#if isInlineDeleteFallback}
		<section class="inline-card-panel is-danger" aria-labelledby={deleteTitleId}>
			<h4 id={deleteTitleId} class="panel-heading">{t('share.deleteTitle')}</h4>
			{#if inlineDeleteError?.errorMessage}
				<div class="panel-error" role="alert">{inlineDeleteError.errorMessage}</div>
			{/if}
			<p class="delete-confirm-text">
				{t('share.deleteConfirm', { title: item.resource.title || item.rawUrl })}
			</p>
			<form method="POST" action="{actionBase}?/deleteShare" class="panel-actions">
				<input type="hidden" name="shareId" value={item.id} />
				<input type="hidden" name="returnTo" value={returnTo} />
				<a href={returnTo} class="btn btn-outline">{t('common.cancel')}</a>
				<button type="submit" class="btn btn-danger">{t('share.deleteTitle')}</button>
			</form>
		</section>
	{/if}

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
	/*
	 * Register entry (docs/designs/izgah-ui-v4.md §4): time and name in a left gutter; note, link,
	 * künye and actions in one column; rules between entries, no card box.
	 */
	.share-card {
		position: relative;
		display: grid;
		grid-template-columns: 104px minmax(0, 1fr);
		column-gap: var(--space-4);
		margin-inline: -10px;
		padding: 14px 10px 12px;
		background: transparent;
		border-block-end: 1px solid var(--color-line);
		outline: none;
		transition: background-color var(--dur-fast) var(--ease);
	}

	.share-card.is-compact {
		grid-template-columns: 88px minmax(0, 1fr);
		padding-block: 10px;
	}

	.share-card:focus-visible {
		outline: 2px solid transparent;
		background: var(--color-surface-2);
		box-shadow: inset 0 0 0 2px var(--color-focus-outer);
	}

	.post-head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-inline-size: 0;
		padding-block-start: 2px;
	}

	.post-body {
		display: grid;
		gap: var(--space-1);
		min-inline-size: 0;
	}

	.post-time {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
	}

	.post-time:hover {
		color: var(--color-text);
		text-decoration: underline;
	}

	.post-author {
		max-inline-size: 100%;
		overflow: hidden;
		font: var(--text-ui);
		font-weight: 500;
		color: var(--color-text-secondary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.unseen-pill {
		padding: 0 4px;
		font: var(--text-micro);
		color: var(--color-highlight-fg);
		background: var(--color-highlight-bg);
		border-radius: var(--radius-xs);
	}

	.post-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-3);
		margin: 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.section-chip {
		position: relative;
		z-index: 2;
		color: var(--color-text-secondary);
		text-decoration-color: var(--color-line-strong);
	}

	.badge-silent,
	.badge-pending {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.post-head-tools {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-block-start: var(--space-1);
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease);
	}

	.share-card:hover .post-head-tools,
	.share-card:focus-within .post-head-tools {
		opacity: 1;
	}

	@media (hover: none) {
		.post-head-tools {
			opacity: 1;
		}
	}

	.preview-trigger {
		position: relative;
		z-index: 2;
		font: var(--text-hint);
		color: var(--color-text-secondary);
		text-decoration-color: var(--color-line-strong);
	}

	@media (max-width: 1023px) {
		.preview-trigger {
			display: none;
		}
	}

	.card-menu-wrap {
		position: relative;
		z-index: 2;
		flex: none;
	}

	/* "Actions" as a word, set like the künye line (izgah-ui-v4 §1). */
	:global(.card-menu-trigger) {
		min-inline-size: 0 !important;
		min-block-size: 24px !important;
		padding: 0 4px !important;
		font: var(--text-hint) !important;
		background: transparent !important;
		border-color: transparent !important;
		color: var(--color-text-muted) !important;
	}

	:global(.card-menu-trigger:hover) {
		color: var(--color-text) !important;
	}

	@media (pointer: coarse) {
		:global(.card-menu-trigger) {
			min-inline-size: 44px !important;
			min-block-size: 44px !important;
		}
	}

	.card-menu-list {
		display: grid;
		gap: 1px;
	}

	.card-menu-item {
		display: flex;
		align-items: center;
		inline-size: 100%;
		min-block-size: 34px;
		padding: 0 var(--space-3);
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text);
		text-align: start;
		text-decoration: none;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.card-menu-item:hover {
		background: var(--color-surface-2);
		text-decoration: none;
	}

	.card-menu-item.is-danger,
	.card-menu-item.is-danger:hover {
		color: var(--color-danger);
	}

	.post-note {
		margin: 0;
		font: var(--text-body);
		color: var(--color-text);
		white-space: pre-line;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		overflow: hidden;
	}

	.post-note.is-expanded {
		display: block;
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}

	.note-toggle {
		justify-self: start;
		padding: 0;
		font: var(--text-hint);
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	/* Single column below 600px: the gutter becomes one line above the note. */
	@media (max-width: 599px) {
		.share-card,
		.share-card.is-compact {
			grid-template-columns: minmax(0, 1fr);
			margin-inline: calc(-1 * var(--gutter));
			padding-inline: var(--gutter);
		}

		.post-head {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: baseline;
			gap: var(--space-2);
			margin-block-end: var(--space-1);
		}

		.post-head-tools {
			margin: 0 0 0 auto;
		}
	}

	/* Inline JS-off panels & Edit/Delete dialogs */
	.inline-card-panel {
		margin-block-start: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-lg);
		background: var(--color-surface-1);
	}

	.inline-card-panel.is-danger {
		border-color: var(--color-danger-border);
	}

	.panel-heading,
	.dialog-title {
		margin: 0 0 var(--space-3);
		font: var(--text-section);
		font-size: 1.0625rem;
		color: var(--color-text);
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
		border: 1px solid var(--color-danger-border);
		border-radius: var(--radius-sm);
		background: var(--color-danger-soft);
		color: var(--color-danger);
		font: var(--text-ui);
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
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.sections-fieldset {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		background: var(--color-surface-1);
	}

	.sections-fieldset > legend {
		padding-inline: var(--space-1);
		margin-inline-start: calc(-1 * var(--space-1));
	}

	.sections-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-block-start: var(--space-2);
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 34px;
		font: var(--text-ui);
		color: var(--color-text);
		cursor: pointer;
	}

	.sections-grid .checkbox-row {
		padding: 0 var(--space-3);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.sections-grid .checkbox-row:hover {
		background: var(--color-surface-3);
		border-color: var(--color-line-strong);
	}

	.sections-grid .checkbox-row:has(input:checked) {
		background: var(--color-accent-soft);
		border-color: var(--color-accent-border);
		color: var(--color-accent-text);
		font-weight: 600;
	}

	.checkbox-row input[type='checkbox'] {
		inline-size: 1rem;
		block-size: 1rem;
		flex-shrink: 0;
	}

	.silent-checkbox {
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--color-line-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
	}

	.delete-confirm-text {
		margin: 0 0 var(--space-4);
		font: var(--text-body);
		color: var(--color-text-secondary);
	}

	.panel-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	@media (forced-colors: active) {
		.share-card {
			box-shadow: none;
			border-color: CanvasText;
		}

		.share-card:focus-visible {
			outline: 2px solid CanvasText;
			box-shadow: none;
		}

		.inline-card-panel {
			border-color: CanvasText;
			box-shadow: none;
		}
	}

	@media (pointer: coarse) {
		.checkbox-row {
			min-block-size: 44px;
		}
	}
</style>
