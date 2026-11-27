<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { modifierLabel } from '#lib/platform.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import PostCard from '#lib/components/feed/PostCard.svelte';
	import ResourceHero from '#lib/components/resource/ResourceHero.svelte';
	import Dialog from '#lib/components/legacy/Dialog.svelte';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
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

	// A server-rendered `form` (a failed submission that reloaded the page) seeds the comment state
	// synchronously; later results from `use:enhance` are applied by the effect below.
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

	const commentDescribedBy = $derived(
		commentErrorMessage ? `${commentHintId} ${commentErrorId}` : commentHintId
	);

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

	const formatTrDateTime = formatWhen;

	const textareaClass =
		'comment-textarea flex field-sizing-content min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-[14px] leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30';
</script>

<svelte:head>
	<title>{pageTitle(data.resource.title || data.resource.domain)}</title>
</svelte:head>

<!-- Resource page (docs/designs/izgah-ui-v5.md §5.3): the hero and the discussion on the left,
     the share history and sections in a sticky column from 1024px. -->
<div
	class="resource-detail-page mx-auto grid w-full max-w-[1120px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-7"
>
	<nav aria-label={t('topbar.location')} class="breadcrumb-nav lg:col-span-2">
		<a
			href="/"
			class="back-link {buttonVariants({
				variant: 'ghost',
				size: 'sm'
			})} -ms-2 text-muted-foreground"
		>
			<ArrowLeft aria-hidden="true" />
			<span>{t('error.backToFeed')}</span>
		</a>
	</nav>

	<div class="resource-main grid min-w-0 content-start gap-6">
		<div class="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
			<ResourceHero
				resource={data.resource}
				originalShareDeleted={data.originalShareDeleted}
				aiSummary={data.aiSummary}
			/>
		</div>

		<section
			id="comments"
			aria-labelledby="resource-comments-heading"
			class="comments-section grid scroll-mt-20 gap-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
		>
			<h2 id="resource-comments-heading" class="text-[15px] font-semibold tracking-[-0.01em]">
				{t('comment.heading', { count: data.resource.commentCount })}
			</h2>

			<div aria-live="polite" class="sr-only">{commentLiveAnnouncement}</div>

			{#if data.comments.length === 0}
				<p class="empty-comments text-[13.5px] text-muted-foreground">{t('comment.empty')}</p>
			{:else}
				<ol class="comment-list grid gap-5">
					{#each data.comments as comment, commentIndex (comment.id)}
						{@const canEditComment = data.user.id === comment.author.id}
						{@const canDeleteComment = canEditComment || data.user.role === 'admin'}
						{@const isEditingInline = editingCommentId === comment.id}

						<li class="comment-card group/comment flex gap-3" data-comment-id={comment.id}>
							<MemberAvatar
								id={comment.author.id}
								name={comment.author.name}
								avatarAssetKey={comment.author.avatarAssetKey}
							/>
							<div class="grid min-w-0 flex-1 gap-1.5">
								<div class="comment-meta flex flex-wrap items-baseline gap-x-2 text-[13px]">
									<span class="comment-author font-medium">{comment.author.name}</span>
									<span class="comment-date text-[12px] text-muted-foreground tabular-nums">
										<time datetime={comment.createdAt}>{formatTrDateTime(comment.createdAt)}</time>
										{#if comment.updatedAt !== comment.createdAt}
											<span class="edited-tag">{t('comment.edited')}</span>
										{/if}
									</span>
									{#if canDeleteComment && !isEditingInline}
										<div
											class="comment-actions ms-auto flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/comment:opacity-100 sm:group-hover/comment:opacity-100"
										>
											{#if canEditComment}
												<button
													type="button"
													class="comment-action-btn {buttonVariants({
														variant: 'ghost',
														size: 'icon-xs'
													})}"
													aria-label={t('comment.editNth', { index: commentIndex + 1 })}
													title={t('common.edit')}
													onclick={() => startEditComment(comment)}
												>
													<Pencil aria-hidden="true" />
												</button>
											{/if}
											<button
												type="button"
												class="comment-action-btn is-danger {buttonVariants({
													variant: 'ghost',
													size: 'icon-xs'
												})} hover:text-destructive"
												aria-label={t('comment.deleteBy', {
													name: comment.author.name,
													index: commentIndex + 1
												})}
												title={t('common.delete')}
												onclick={() => openDeleteCommentDialog(comment)}
											>
												<Trash2 aria-hidden="true" />
											</button>
										</div>
									{/if}
								</div>

								{#if isEditingInline}
									<form
										method="POST"
										action="?/updateComment"
										use:enhance={handleUpdateCommentEnhance}
										class="comment-edit-form grid gap-2"
									>
										<input type="hidden" name="commentId" value={comment.id} />
										<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />
										<label for={`edit-comment-${comment.id}`} class="sr-only">
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
											class={textareaClass}></textarea>
										{#if editCommentError}
											<p class="comment-error-msg text-[12.5px] text-destructive" role="alert">
												{editCommentError}
											</p>
										{/if}
										<div class="comment-edit-actions flex justify-end gap-2">
											<button
												type="button"
												class={buttonVariants({ variant: 'ghost', size: 'sm' })}
												onclick={cancelEditComment}
											>
												{t('common.cancel')}
											</button>
											<button
												type="submit"
												class={buttonVariants({ size: 'sm' })}
												disabled={editCommentSubmitting}
											>
												{editCommentSubmitting ? t('common.saving') : t('common.save')}
											</button>
										</div>
									</form>
								{:else}
									<p
										class="comment-body text-[14px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line"
									>
										{comment.body}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}

			<form
				method="POST"
				action="?/addComment"
				novalidate
				use:enhance={handleAddCommentEnhance}
				class="comment-composer-form grid gap-2 border-t border-hairline pt-5"
			>
				<input type="hidden" name="returnTo" value={`/resources/${data.resource.id}`} />

				{#if commentFormErrorBanner}
					<div
						class="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive"
						role="alert"
					>
						<span>{commentFormErrorBanner}</span>
					</div>
				{/if}

				<div class="flex gap-3">
					<MemberAvatar
						id={data.user.id}
						name={data.user.name}
						avatarAssetKey={data.user.avatarAssetKey}
						class="mt-0.5 size-7 text-[11px] max-sm:hidden"
					/>
					<div class="comment-field grid min-w-0 flex-1 gap-1.5">
						<label for={commentTextareaId} class="sr-only">{t('comment.yourComment')}</label>
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
							class={textareaClass}></textarea>
						<p
							id={commentErrorId}
							class="field-error comment-error-msg text-[12.5px] text-destructive"
							class:hidden={!commentErrorMessage}
						>
							{commentErrorMessage ?? t('comment.required')}
						</p>
						<div class="comment-submit-row flex flex-wrap items-center justify-between gap-2">
							<p id={commentHintId} class="composer-hint text-[12px] text-muted-foreground">
								{t('comment.submitHint', { modifier: modifierLabel(data.modifierKey) })}
							</p>
							<div class="flex items-center gap-3">
								<span class="char-counter text-[12px] text-muted-foreground tabular-nums">
									{commentBody.trim().length} / {MAX_COMMENT_LENGTH}
								</span>
								<button
									type="submit"
									class={buttonVariants({ size: 'sm' })}
									disabled={commentSubmitting}
								>
									{commentSubmitting ? t('comment.sending') : t('comment.send')}
								</button>
							</div>
						</div>
					</div>
				</div>
			</form>
		</section>
	</div>

	<aside
		class="resource-side grid min-w-0 content-start gap-6 lg:sticky lg:top-[calc(var(--sticky-top)+1rem)] lg:max-h-[calc(100dvh-var(--sticky-top)-2rem)] lg:overflow-y-auto lg:overscroll-contain"
		aria-label={t('resource.side')}
	>
		<section aria-labelledby="resource-shares-heading" class="grid gap-3">
			<header class="flex items-center gap-2 px-1">
				<h2 id="resource-shares-heading" class="text-[13px] font-semibold">
					{t('resource.shareHistory')}
				</h2>
				<span
					class="card-count rounded-full bg-muted px-1.5 text-[11.5px] font-medium text-muted-foreground tabular-nums"
				>
					{data.shares.length}
				</span>
			</header>
			<ol class="feed-list timeline grid gap-3" role="list">
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
						/>
					</li>
				{/each}
			</ol>
		</section>

		{#if resourceSections.length > 0}
			<section class="grid gap-3" aria-labelledby="resource-sections-heading">
				<h2 id="resource-sections-heading" class="px-1 text-[13px] font-semibold">
					{t('nav.sections')}
				</h2>
				<ul class="section-tags flex flex-wrap gap-1.5" role="list">
					{#each resourceSections as section (section.id)}
						<li>
							<a
								href="/sections/{section.slug}"
								class="tag inline-flex rounded-full border border-hairline bg-card px-2.5 py-1 text-[12.5px] text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground"
							>
								<span>{section.name}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</aside>

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
</div>

<style>
	/* Phones: the composer sticks above the tab bar (izgah-ui-v2 §8, kept in v5). */
	@media (max-width: 767px) {
		.comment-composer-form {
			position: sticky;
			inset-block-end: var(--tab-bar-h);
			z-index: 10;
			padding: var(--space-3);
			margin-inline: -1.25rem;
			margin-block-end: -1.25rem;
			background: var(--card);
			border-block-start: 1px solid var(--border);
			border-radius: 0 0 12px 12px;
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

		/* The tab bar hides while typing or while the draft has text. */
		.comment-composer-form:focus-within,
		.comment-composer-form:has(textarea:not(:placeholder-shown)) {
			inset-block-end: 0;
			padding-block-end: max(var(--space-3), env(safe-area-inset-bottom));
		}
	}
</style>
