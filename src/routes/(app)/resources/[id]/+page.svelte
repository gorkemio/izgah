<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { modifierLabel } from '#lib/platform.ts';
	import { formatDateTime } from '#lib/format/date.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import PostCard from '#lib/components/feed/PostCard.svelte';
	import ResourceHero from '#lib/components/resource/ResourceHero.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import type { AvatarStackItem } from '#lib/components/ui/AvatarStack.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import type { ShareCardFormError } from '#lib/types/feed.ts';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import type { PageData } from './$types';

	const MAX_COMMENT_LENGTH = 2000;

	interface ResourceActionFormPayload {
		formType?: string;
		commentId?: string;
		shareId?: string;
		errorMessage?: string;
		fieldErrors?: Record<string, string[]>;
		values?: {
			body?: string;
			note?: string;
			sectionIds?: string[];
			contentType?: string;
			silentMode?: boolean;
		};
	}

	let { data, form }: { data: PageData; form: ResourceActionFormPayload | null } = $props();

	let hydrated = $state(false);

	// A failed no-JS submission re-renders this page on the server with `form`; initialise the
	// comment state from it synchronously so the error and the typed text survive without JS
	// (an $effect never runs during SSR). Later client-side results are applied by the effect below.
	const initialForm = untrack(() => form);
	const initialAddError =
		initialForm?.formType === 'addComment' && initialForm.errorMessage ? initialForm : null;
	const initialEditError =
		initialForm?.formType === 'updateComment' && initialForm.commentId ? initialForm : null;

	// New comment form state (validate-input-after-interaction + accessible-error-announcement)
	let commentBody = $state(initialAddError?.values?.body ?? '');
	let commentHasInteracted = $state(false);
	let commentHasBlurred = $state(false);
	let commentHasSubmitted = $state(Boolean(initialAddError));

	let commentErrorMessage = $state<string | null>(
		initialAddError
			? (initialAddError.fieldErrors?.body?.[0] ??
					initialAddError.errorMessage ??
					t('comment.invalid'))
			: null
	);

	let commentSubmitting = $state(false);
	let commentFormErrorBanner = $state<string | null>(initialAddError?.errorMessage ?? null);
	let commentLiveAnnouncement = $state('');
	let commentTextareaEl = $state<HTMLTextAreaElement | null>(null);
	let liveAnnounceTimer: number | null = null;
	let lastServerCommentFormRef: ResourceActionFormPayload | null = initialForm;

	// Edit comment state
	let editingCommentId = $state<string | null>(initialEditError?.commentId ?? null);
	let editCommentBody = $state(initialEditError?.values?.body ?? '');

	let editCommentError = $state<string | null>(
		initialEditError
			? (initialEditError.fieldErrors?.body?.[0] ?? initialEditError.errorMessage ?? null)
			: null
	);

	let editCommentSubmitting = $state(false);

	// Delete comment confirmation <dialog> state
	let deleteCommentTarget = $state<{ id: string; body: string; authorName: string } | null>(null);
	let deleteCommentDialogOpen = $state(false);
	let deleteCommentSubmitting = $state(false);
	let deleteCommentError = $state<string | null>(
		initialForm?.formType === 'deleteComment' ? (initialForm.errorMessage ?? null) : null
	);
	const commentTextareaId = 'resource-new-comment-body';
	const commentHintId = 'resource-new-comment-hint';
	const commentErrorId = 'resource-new-comment-error';

	$effect(() => {
		hydrated = true;
	});

	$effect(() => {
		if (form && form !== lastServerCommentFormRef) {
			lastServerCommentFormRef = form;
			if (form.formType === 'addComment' && form.errorMessage) {
				commentHasSubmitted = true;
				commentBody = form.values?.body ?? commentBody;
				commentErrorMessage =
					form.fieldErrors?.body?.[0] ?? form.errorMessage ?? t('comment.invalid');
				commentFormErrorBanner = form.errorMessage;
			}
			if (form.formType === 'updateComment' && form.commentId) {
				editingCommentId = form.commentId;
				editCommentBody = form.values?.body ?? '';
				editCommentError = form.fieldErrors?.body?.[0] ?? form.errorMessage ?? null;
			}
			if (form.formType === 'deleteComment' && form.errorMessage) {
				deleteCommentError = form.errorMessage;
			}
		}
	});

	$effect(() => {
		return () => {
			if (liveAnnounceTimer !== null) {
				window.clearTimeout(liveAnnounceTimer);
			}
		};
	});

	// Sections this resource was shared to, across every active share.
	const resourceSections = $derived.by(() => {
		const seen = new Map<string, { id: string; slug: string; name: string }>();
		for (const share of data.shares) {
			for (const section of share.sections) {
				seen.set(section.id, section);
			}
		}
		return [...seen.values()];
	});

	// Distinct sharers for the ResourceHero AvatarStack.
	const resourceSharers = $derived.by((): AvatarStackItem[] => {
		const seen = new Map<string, AvatarStackItem>();
		for (const share of data.shares) {
			if (!seen.has(share.author.id)) {
				seen.set(share.author.id, {
					name: share.author.name,
					self: share.author.id === data.user.id
				});
			}
		}
		return [...seen.values()];
	});

	const commentDescribedBy = $derived(
		commentErrorMessage ? `${commentHintId} ${commentErrorId}` : commentHintId
	);

	const activeShareFormError = $derived.by((): ShareCardFormError | null => {
		if (!form || !form.shareId) {
			return null;
		}
		if (form.formType === 'updateShare' || form.formType === 'deleteShare') {
			return {
				formType: form.formType,
				shareId: form.shareId,
				errorMessage: form.errorMessage ?? t('common.actionFailed'),
				fieldErrors: form.fieldErrors,
				values: form.values
			};
		}
		return null;
	});

	function validateCommentValue(value: string): string | null {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return t('comment.required');
		}
		if (trimmed.length > MAX_COMMENT_LENGTH) {
			return t('comment.tooLong', { max: MAX_COMMENT_LENGTH });
		}
		return null;
	}

	function scheduleErrorAnnouncement(message: string): void {
		if (liveAnnounceTimer !== null) {
			window.clearTimeout(liveAnnounceTimer);
		}
		commentLiveAnnouncement = '';
		liveAnnounceTimer = window.setTimeout(() => {
			liveAnnounceTimer = null;
			commentLiveAnnouncement = t('comment.yourCommentAnnounce', { message });
		}, 400);
	}

	function clearErrorAnnouncement(): void {
		if (liveAnnounceTimer !== null) {
			window.clearTimeout(liveAnnounceTimer);
			liveAnnounceTimer = null;
		}
		commentLiveAnnouncement = '';
	}

	function handleCommentInput(event: Event): void {
		const el = event.currentTarget as HTMLTextAreaElement;
		commentBody = el.value;
		commentHasInteracted = true;
		commentFormErrorBanner = null;

		const validationMsg = validateCommentValue(el.value);
		el.setCustomValidity('');

		if (!validationMsg) {
			commentErrorMessage = null;
			el.classList.remove('user-invalid-fallback');
			clearErrorAnnouncement();
		} else if (commentHasBlurred || commentHasSubmitted) {
			el.setCustomValidity(validationMsg);
			commentErrorMessage = validationMsg;
			if (typeof CSS === 'undefined' || !CSS.supports('selector(:user-invalid)')) {
				el.classList.add('user-invalid-fallback');
			}
		}
	}

	function handleCommentBlur(event: Event): void {
		const el = event.currentTarget as HTMLTextAreaElement;
		commentHasBlurred = true;
		if (!commentHasInteracted && !commentHasSubmitted) {
			return;
		}
		const validationMsg = validateCommentValue(el.value);
		if (validationMsg) {
			el.setCustomValidity(validationMsg);
			commentErrorMessage = validationMsg;
			if (typeof CSS === 'undefined' || !CSS.supports('selector(:user-invalid)')) {
				el.classList.add('user-invalid-fallback');
			}
			scheduleErrorAnnouncement(validationMsg);
		} else {
			el.setCustomValidity('');
			commentErrorMessage = null;
			el.classList.remove('user-invalid-fallback');
			clearErrorAnnouncement();
		}
	}

	function handleImeSafeTextareaKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			if (event.isComposing || event.keyCode === 229) {
				return;
			}
			if (event.currentTarget instanceof HTMLTextAreaElement) {
				event.currentTarget.form?.requestSubmit();
			}
		}
	}

	const handleAddCommentEnhance: SubmitFunction = ({ cancel }) => {
		// Enter submits via requestSubmit(), which ignores the disabled button: guard in-flight posts
		// so a double Enter cannot create two comments (and two notifications).
		if (commentSubmitting) {
			cancel();
			return;
		}
		commentHasSubmitted = true;
		commentFormErrorBanner = null;
		const validationMsg = validateCommentValue(commentBody);

		if (validationMsg) {
			commentErrorMessage = validationMsg;
			if (commentTextareaEl) {
				commentTextareaEl.setCustomValidity(validationMsg);
				if (typeof CSS === 'undefined' || !CSS.supports('selector(:user-invalid)')) {
					commentTextareaEl.classList.add('user-invalid-fallback');
				}
				commentTextareaEl.focus();
			}
			clearErrorAnnouncement();
			cancel();
			return;
		}

		if (commentTextareaEl) {
			commentTextareaEl.setCustomValidity('');
			commentTextareaEl.classList.remove('user-invalid-fallback');
		}
		commentErrorMessage = null;
		commentSubmitting = true;

		return async ({ result }) => {
			commentSubmitting = false;

			if (result.type === 'failure') {
				const payload = result.data as ResourceActionFormPayload | undefined;
				const msg =
					payload?.fieldErrors?.body?.[0] ?? payload?.errorMessage ?? t('comment.addFailed');
				commentErrorMessage = msg;
				commentFormErrorBanner = payload?.errorMessage ?? msg;
				if (commentTextareaEl) {
					commentTextareaEl.setCustomValidity(msg);
					commentTextareaEl.focus();
				}
				return;
			}

			if (result.type === 'error') {
				commentFormErrorBanner = t('comment.addUnexpected');
				return;
			}

			if (result.type === 'redirect') {
				commentBody = '';
				commentHasInteracted = false;
				commentHasBlurred = false;
				commentHasSubmitted = false;
				commentErrorMessage = null;
				clearErrorAnnouncement();
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				commentBody = '';
				commentHasInteracted = false;
				commentHasBlurred = false;
				commentHasSubmitted = false;
				commentErrorMessage = null;
				commentFormErrorBanner = null;
				if (commentTextareaEl) {
					commentTextareaEl.setCustomValidity('');
					commentTextareaEl.classList.remove('user-invalid-fallback');
				}
				clearErrorAnnouncement();
				await invalidate('app:feed');
			}
		};
	};

	function startEditComment(comment: PageData['comments'][number]): void {
		editingCommentId = comment.id;
		editCommentBody = comment.body;
		editCommentError = null;
		editCommentSubmitting = false;
	}

	function cancelEditComment(): void {
		editingCommentId = null;
		editCommentBody = '';
		editCommentError = null;
		editCommentSubmitting = false;
	}

	const handleUpdateCommentEnhance: SubmitFunction = ({ cancel }) => {
		const validationMsg = validateCommentValue(editCommentBody);
		if (validationMsg) {
			editCommentError = validationMsg;
			cancel();
			return;
		}
		editCommentError = null;
		editCommentSubmitting = true;

		return async ({ result }) => {
			editCommentSubmitting = false;

			if (result.type === 'failure') {
				const payload = result.data as ResourceActionFormPayload | undefined;
				editCommentError =
					payload?.fieldErrors?.body?.[0] ?? payload?.errorMessage ?? t('comment.updateFailed');
				return;
			}

			if (result.type === 'error') {
				editCommentError = t('comment.updateUnexpected');
				return;
			}

			if (result.type === 'redirect') {
				editingCommentId = null;
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				editingCommentId = null;
				editCommentBody = '';
				editCommentError = null;
				await invalidate('app:feed');
			}
		};
	};

	function openDeleteCommentDialog(comment: PageData['comments'][number]): void {
		deleteCommentTarget = {
			id: comment.id,
			body: comment.body,
			authorName: comment.author.name
		};
		deleteCommentError = null;
		deleteCommentSubmitting = false;
		deleteCommentDialogOpen = true;
	}

	const handleDeleteCommentEnhance: SubmitFunction = () => {
		deleteCommentError = null;
		deleteCommentSubmitting = true;

		return async ({ result }) => {
			deleteCommentSubmitting = false;

			if (result.type === 'failure') {
				const payload = result.data as ResourceActionFormPayload | undefined;
				deleteCommentError = payload?.errorMessage ?? t('comment.deleteFailed');
				return;
			}

			if (result.type === 'error') {
				deleteCommentError = t('comment.deleteUnexpected');
				return;
			}

			if (result.type === 'redirect') {
				deleteCommentDialogOpen = false;
				deleteCommentTarget = null;
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				deleteCommentDialogOpen = false;
				deleteCommentTarget = null;
				await invalidate('app:feed');
			}
		};
	};

	const formatTrDateTime = formatDateTime;
</script>

<svelte:head>
	<title>{pageTitle(data.resource.title || data.resource.domain)}</title>
</svelte:head>

<div class="resource-detail-page">
	<nav aria-label={t('topbar.location')} class="breadcrumb-nav">
		<a href="/" class="back-link">
			<Icon name="arrowLeft" size={15} />
			<span>{t('error.backToFeed')}</span>
		</a>
	</nav>

	<div class="resource-main">
		<ResourceHero
			resource={data.resource}
			originalShareDeleted={data.originalShareDeleted}
			sharers={resourceSharers}
		/>

		<section
			id="comments"
			aria-labelledby="resource-comments-heading"
			class="studio-card comments-section"
		>
			<header class="card-head">
				<h2 id="resource-comments-heading" class="card-heading">
					{t('comment.heading', { count: data.resource.commentCount })}
				</h2>
			</header>

			<div aria-live="polite" class="visually-hidden">{commentLiveAnnouncement}</div>

			{#if data.comments.length === 0}
				<p class="empty-comments">{t('comment.empty')}</p>
			{:else}
				<ol class="comment-list">
					{#each data.comments as comment, commentIndex (comment.id)}
						{@const canEditComment = data.user.id === comment.author.id}
						{@const canDeleteComment = canEditComment || data.user.role === 'admin'}
						{@const isEditingInline =
							editingCommentId === comment.id ||
							(!hydrated && data.editCommentId === comment.id && canEditComment)}
						{@const isInlineNoJsDelete =
							!hydrated && data.deleteCommentId === comment.id && canDeleteComment}

						<li class="comment-card" data-comment-id={comment.id}>
							<div class="comment-meta">
								<Avatar
									name={comment.author.name}
									self={comment.author.id === data.user.id}
									size={26}
								/>
								<span class="comment-author">{comment.author.name}</span>
								<span class="comment-date">
									<time datetime={comment.createdAt}>{formatTrDateTime(comment.createdAt)}</time>
									{#if comment.updatedAt !== comment.createdAt}
										<span class="edited-tag">{t('comment.edited')}</span>
									{/if}
								</span>
							</div>

							{#if isEditingInline}
								<form
									method="POST"
									action="?/updateComment"
									use:enhance={handleUpdateCommentEnhance}
									class="comment-edit-form"
								>
									<input type="hidden" name="commentId" value={comment.id} />
									<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />
									<label for={`edit-comment-${comment.id}`} class="field-label">
										{t('comment.editLabel')}
									</label>
									<textarea
										id={`edit-comment-${comment.id}`}
										name="body"
										rows="3"
										required
										minlength="1"
										maxlength={MAX_COMMENT_LENGTH}
										value={editCommentBody || comment.body}
										oninput={(event) => {
											editCommentBody = event.currentTarget.value;
											editCommentError = null;
										}}
										onkeydown={handleImeSafeTextareaKeydown}
										aria-invalid={editCommentError ? 'true' : 'false'}
										class="textarea comment-textarea"
										class:is-invalid={Boolean(editCommentError)}></textarea>
									{#if editCommentError}
										<p class="comment-error-msg is-visible" role="alert">{editCommentError}</p>
									{/if}
									<div class="comment-edit-actions">
										{#if hydrated}
											<button
												type="button"
												class="btn btn-subtle btn-sm"
												onclick={cancelEditComment}
											>
												{t('common.cancel')}
											</button>
										{:else}
											<a href={`/resources/${data.resource.id}`} class="btn btn-subtle btn-sm">
												{t('common.cancel')}
											</a>
										{/if}
										<button
											type="submit"
											class="btn btn-primary btn-sm"
											disabled={editCommentSubmitting}
										>
											{editCommentSubmitting ? t('common.saving') : t('common.save')}
										</button>
									</div>
								</form>
							{:else}
								<p class="comment-body">{comment.body}</p>
							{/if}

							{#if canDeleteComment && !isEditingInline}
								<div class="comment-actions">
									{#if canEditComment}
										{#if hydrated}
											<button
												type="button"
												class="comment-action-btn"
												aria-label={t('comment.editNth', { index: commentIndex + 1 })}
												onclick={() => startEditComment(comment)}
											>
												{t('common.edit')}
											</button>
										{:else}
											<a
												href={`/resources/${data.resource.id}?editComment=${encodeURIComponent(comment.id)}`}
												class="comment-action-btn"
											>
												{t('common.edit')}
											</a>
										{/if}
									{/if}

									{#if hydrated}
										<button
											type="button"
											class="comment-action-btn is-danger"
											aria-label={t('comment.deleteBy', {
												name: comment.author.name,
												index: commentIndex + 1
											})}
											onclick={() => openDeleteCommentDialog(comment)}
										>
											{t('common.delete')}
										</button>
									{:else}
										<a
											href={`/resources/${data.resource.id}?deleteComment=${encodeURIComponent(comment.id)}`}
											class="comment-action-btn is-danger"
										>
											{t('common.delete')}
										</a>
									{/if}
								</div>
							{/if}

							{#if isInlineNoJsDelete}
								<div class="inline-delete-panel">
									<p>{t('comment.deleteConfirmShort')}</p>
									<form method="POST" action="?/deleteComment" class="comment-edit-actions">
										<input type="hidden" name="commentId" value={comment.id} />
										<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />
										<a href={`/resources/${data.resource.id}`} class="btn btn-subtle btn-sm">
											{t('common.cancel')}
										</a>
										<button type="submit" class="btn btn-danger btn-sm">
											{t('comment.deleteTitle')}
										</button>
									</form>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}

			<form
				method="POST"
				action="?/addComment"
				novalidate
				use:enhance={handleAddCommentEnhance}
				class="comment-composer-form"
			>
				<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />

				{#if commentFormErrorBanner}
					<div class="panel-error" role="alert">
						<Icon name="alert" size={16} />
						<span>{commentFormErrorBanner}</span>
					</div>
				{/if}

				<div class="field comment-field">
					<label for={commentTextareaId} class="field-label">{t('comment.yourComment')}</label>
					<textarea
						bind:this={commentTextareaEl}
						id={commentTextareaId}
						data-draft
						name="body"
						rows="3"
						required
						minlength="1"
						maxlength={MAX_COMMENT_LENGTH}
						value={commentBody}
						aria-invalid={commentErrorMessage ? 'true' : 'false'}
						aria-describedby={commentDescribedBy}
						data-error={commentErrorId}
						oninput={handleCommentInput}
						onblur={handleCommentBlur}
						onkeydown={handleImeSafeTextareaKeydown}
						placeholder={t('comment.placeholder')}
						class="textarea comment-textarea"
						class:is-invalid={Boolean(commentErrorMessage)}></textarea>
					<p
						id={commentErrorId}
						class="field-error comment-error-msg"
						class:is-visible={Boolean(commentErrorMessage)}
					>
						{commentErrorMessage ?? t('comment.required')}
					</p>
				</div>

				<div class="comment-submit-row">
					<p id={commentHintId} class="field-hint composer-hint">
						{t('comment.submitHint', { modifier: modifierLabel(data.modifierKey) })}
					</p>
					<div class="comment-submit-controls">
						<span class="char-counter">{commentBody.trim().length} / {MAX_COMMENT_LENGTH}</span>
						<button type="submit" class="btn btn-primary btn-sm" disabled={commentSubmitting}>
							{commentSubmitting ? t('comment.sending') : t('comment.send')}
						</button>
					</div>
				</div>
			</form>
		</section>
	</div>

	<aside class="resource-side" aria-label={t('resource.side')}>
		<section aria-labelledby="resource-shares-heading" class="studio-card side-card">
			<header class="card-head">
				<h2 id="resource-shares-heading" class="card-heading">{t('resource.shareHistory')}</h2>
				<span class="card-count">{data.shares.length}</span>
			</header>
			<ol class="feed-list timeline" role="list">
				{#each data.shares as shareItem (shareItem.id)}
					<li class="timeline-entry">
						<PostCard
							item={shareItem}
							sections={data.sections}
							currentUserId={data.user.id}
							isAdmin={data.user.role === 'admin'}
							actionBase={`/resources/${data.resource.id}`}
							returnTo={`/resources/${data.resource.id}`}
							compact
							activeEditShareId={data.editShareId}
							activeDeleteShareId={data.deleteShareId}
							activeFormError={activeShareFormError}
						/>
					</li>
				{/each}
			</ol>
		</section>

		{#if resourceSections.length > 0}
			<section class="studio-card side-card" aria-labelledby="resource-sections-heading">
				<header class="card-head">
					<h2 id="resource-sections-heading" class="card-heading">{t('nav.sections')}</h2>
				</header>
				<ul class="section-tags" role="list">
					{#each resourceSections as section, index (section.id)}
						<li>
							<a href="/sections/{section.slug}" class="tag" class:tag-accent={index === 0}>
								<Icon name="hash" size={12} />
								<span>{section.name}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</aside>

	{#if hydrated}
		<Dialog
			bind:open={deleteCommentDialogOpen}
			id="delete-comment-dialog"
			titleId="delete-comment-dialog-title"
			closedby="closerequest"
		>
			{#snippet children({ closeNow })}
				<h3 id="delete-comment-dialog-title" class="dialog-title">{t('comment.deleteTitle')}</h3>
				{#if deleteCommentError}
					<div class="panel-error" role="alert">
						<Icon name="alert" size={16} />
						<span>{deleteCommentError}</span>
					</div>
				{/if}
				<p class="dialog-confirm-text">
					{t('comment.deleteConfirm', { name: deleteCommentTarget?.authorName ?? '' })}
				</p>
				<div class="dialog-actions">
					<!-- svelte-ignore a11y_autofocus -->
					<button type="button" class="btn btn-subtle" autofocus onclick={() => closeNow('cancel')}>
						{t('common.cancel')}
					</button>
					<form method="POST" action="?/deleteComment" use:enhance={handleDeleteCommentEnhance}>
						<input type="hidden" name="commentId" value={deleteCommentTarget?.id ?? ''} />
						<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />
						<button type="submit" class="btn btn-danger" disabled={deleteCommentSubmitting}>
							{deleteCommentSubmitting ? t('common.deleting') : t('comment.deleteTitle')}
						</button>
					</form>
				</div>
			{/snippet}
		</Dialog>
	{/if}
</div>

<style>
	/* >= 1024px: preview + comments | share timeline + sections (izgah-ui-v3 §9). */
	.resource-detail-page {
		display: grid;
		gap: var(--space-5);
		max-inline-size: var(--wide-w);
	}

	.resource-main,
	.resource-side {
		display: grid;
		align-content: start;
		gap: var(--space-5);
		min-inline-size: 0;
	}

	@media (min-width: 1024px) {
		.resource-detail-page {
			grid-template-columns: minmax(0, 1fr) 308px;
			grid-template-areas:
				'nav nav'
				'main side';
			column-gap: 26px;
			row-gap: var(--space-4);
		}

		.breadcrumb-nav {
			grid-area: nav;
		}

		.resource-main {
			grid-area: main;
		}

		.resource-side {
			grid-area: side;
			position: sticky;
			inset-block-start: calc(var(--sticky-top) + var(--space-4));
			max-block-size: calc(100dvh - var(--sticky-top) - 2 * var(--space-4));
			overflow-y: auto;
			overscroll-behavior: contain;
		}
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: var(--text-ui);
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.studio-card {
		display: grid;
		gap: var(--space-4);
		min-inline-size: 0;
		padding: var(--space-4);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
	}

	@media (min-width: 640px) {
		.studio-card {
			padding: 20px 22px;
		}
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	/* Strict serif boundary: panel h2 subheadings stay --font-sans (--text-section). */
	.card-heading {
		font: var(--text-section);
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.card-count {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* Timeline: vertical hairline spine with subtle accent dots. */
	.timeline {
		border-inline-start: 1px solid var(--color-line);
		margin-inline-start: 6px;
		padding-inline-start: var(--space-4);
		gap: var(--space-4);
	}

	.timeline-entry {
		position: relative;
		min-inline-size: 0;
	}

	.timeline-entry::before {
		content: '';
		position: absolute;
		inset-inline-start: calc(-1 * var(--space-4) - 4px);
		inset-block-start: 12px;
		inline-size: 7px;
		block-size: 7px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-surface-1);
	}

	.timeline :global(.share-card) {
		margin-inline: 0;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	.section-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Comments ------------------------------------------------------------ */
	.comments-section {
		scroll-margin-block-start: calc(var(--sticky-top) + var(--space-4));
	}

	.empty-comments {
		padding: var(--space-4);
		font: var(--text-hint);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
	}

	.comment-list {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.comment-card {
		display: grid;
		gap: var(--space-2);
		padding-block: var(--space-4);
		border-block-end: 1px solid var(--color-line);
	}

	.comment-card:first-child {
		padding-block-start: 0;
	}

	.comment-card:last-child {
		padding-block-end: 0;
		border-block-end: 0;
	}

	.comment-card:target {
		padding-inline: var(--space-3);
		background: var(--color-surface-2);
		border-radius: var(--radius-sm);
	}

	.comment-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.comment-author {
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.comment-date,
	.edited-tag {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.comment-body {
		font: var(--text-body);
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.comment-actions,
	.comment-edit-actions,
	.dialog-actions,
	.comment-submit-row,
	.comment-submit-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.comment-actions {
		margin-inline-start: calc(-1 * var(--space-2));
	}

	.comment-submit-row {
		justify-content: space-between;
	}

	.comment-action-btn {
		display: inline-flex;
		align-items: center;
		min-block-size: 30px;
		padding: 0 var(--space-2);
		font: var(--text-ui);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.comment-action-btn:hover {
		color: var(--color-text);
		background: var(--color-surface-2);
		text-decoration: none;
	}

	.comment-action-btn.is-danger:hover {
		color: var(--color-danger);
		background: var(--color-danger-soft);
	}

	.comment-composer-form,
	.comment-edit-form,
	.inline-delete-panel {
		display: grid;
		gap: var(--space-3);
	}

	.inline-delete-panel {
		padding: var(--space-3);
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger-border);
		border-radius: var(--radius-sm);
		font: var(--text-ui);
		color: var(--color-text);
	}

	.comment-composer-form {
		padding-block-start: var(--space-4);
		border-block-start: 1px solid var(--color-line);
	}

	.composer-hint {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}

	.char-counter {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.comment-textarea.is-invalid {
		border-color: var(--color-danger);
	}

	.comment-error-msg {
		display: none;
	}

	.comment-error-msg.is-visible {
		display: block;
	}

	.panel-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		font: var(--text-ui);
		color: var(--color-danger);
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger-border);
		border-radius: var(--radius-sm);
	}

	@media (pointer: coarse) {
		.comment-action-btn {
			min-block-size: 44px;
		}
	}

	.dialog-title {
		font: var(--text-section);
		font-size: 1.125rem;
		margin-block-end: var(--space-3);
		color: var(--color-text);
	}

	.dialog-confirm-text {
		color: var(--color-text-secondary);
		margin-block-end: var(--space-4);
	}

	.dialog-actions {
		justify-content: flex-end;
	}

	/* Phones: the new-comment form stays at the bottom edge, above the tab bar (§13). */
	@media (max-width: 767px) {
		.comment-composer-form {
			position: sticky;
			inset-block-end: var(--tab-bar-h);
			z-index: 10;
			gap: var(--space-2);
			padding: var(--space-3);
			margin-inline: calc(-1 * var(--space-4));
			margin-block-end: calc(-1 * var(--space-4));
			background: var(--color-surface-1);
			border-block-start: 1px solid var(--color-line);
			border-radius: 0 0 var(--radius-md) var(--radius-md);
		}

		/* Collapsed to one line while empty and unfocused, so it never covers the thread. It stays
		   open once it has text: on iOS tapping the submit button blurs the field, and collapsing
		   then would move the button out from under the finger. */
		.comment-composer-form:not(:focus-within):has(textarea:placeholder-shown) .composer-hint,
		.comment-composer-form:not(:focus-within):has(textarea:placeholder-shown) .char-counter {
			display: none;
		}

		.comment-composer-form:not(:focus-within):has(textarea:placeholder-shown) .comment-textarea {
			min-block-size: 44px;
			block-size: 44px;
			resize: none;
		}

		/* The tab bar hides while typing or while the draft has text, so the form drops to the
		   very bottom in both cases. */
		.comment-composer-form:focus-within,
		.comment-composer-form:has(textarea:not(:placeholder-shown)) {
			inset-block-end: 0;
			padding-block-end: max(var(--space-3), env(safe-area-inset-bottom));
		}
	}

	@media (forced-colors: active) {
		.studio-card {
			box-shadow: none;
		}

		.timeline-entry::before {
			background: CanvasText;
			box-shadow: none;
		}
	}
</style>
