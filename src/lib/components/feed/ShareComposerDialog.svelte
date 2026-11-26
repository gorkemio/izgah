<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { contentTypeLabel } from '#lib/types/feed.ts';
	import { page } from '$app/state';
	import { shortcutLabel, type ModifierKey } from '#lib/platform.ts';
	import { formatShortDate } from '#lib/format/date.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import Dialog from '#lib/components/legacy/Dialog.svelte';
	import { extractFirstUrlFromText } from '#lib/links/parse-url.ts';
	import type { SectionListItem } from '#lib/server/sections/service.ts';
	import { getComposerController } from '#lib/share/composer-controller.svelte.ts';
	import type { ContentType } from '#lib/types/domain.ts';

	interface DuplicateCheckResult {
		exists: boolean;
		canonicalUrl: string;
		rawUrl: string;
		suggestedContentType: ContentType;
		suggestedSections?: Array<{ id: string; name: string; source: 'history' | 'ai' }>;
		originalShareDeleted?: boolean;
		resource?: {
			id: string;
			title: string | null;
			likeCount: number;
			commentCount: number;
		};
		sharesSummary?: {
			totalCount: number;
			firstShare: {
				authorName: string;
				createdAt: string;
				isFeedVisible: boolean;
				sectionNames: string[];
			} | null;
		};
	}

	export interface ShareComposerInitialState {
		url?: string;
		note?: string;
		sectionIds?: string[];
		contentType?: string;
		silentMode?: boolean;
		errorMessage?: string;
		fieldErrors?: Record<string, string[]>;
	}

	interface Props {
		open?: boolean;
		/** dialog: modal; feed: inline form at the top of / and /sections/[slug] (izgah-ui-v2 §8.1). */
		variant?: 'dialog' | 'feed';
		/** Sections pre-selected on a section page; re-applied after each successful share. */
		presetSectionIds?: string[];
		/** One-shot fill request (paste, drop) routed by the composer controller. */
		prefill?: { url: string; note: string | null; seq: number } | null;
		sections: SectionListItem[];
		isAdmin: boolean;
		actionUrl: string;
		returnTo: string;
		navigateHomeOnSuccess?: boolean;
		initialValues?: ShareComposerInitialState;
	}

	let {
		open = $bindable(false),
		variant = 'dialog',
		presetSectionIds = [],
		prefill = null,
		sections,
		isAdmin,
		actionUrl,
		returnTo,
		navigateHomeOnSuccess = false,
		initialValues
	}: Props = $props();

	const inlineMode = $derived(variant !== 'dialog');
	const controller = getComposerController();
	let rootEl = $state<HTMLElement | null>(null);
	let urlInputEl = $state<HTMLInputElement | null>(null);
	let noteInputEl = $state<HTMLTextAreaElement | null>(null);

	const rawUid = $props.id();
	const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '-');
	const titleId = `share-composer-title-${uid}`;
	const urlInputId = `share-url-${uid}`;
	const noteInputId = `share-note-${uid}`;
	const typeSelectId = `share-type-${uid}`;

	let hydrated = $state(false);
	let urlValue = $state('');
	let noteValue = $state('');
	let selectedSectionIds = $state<string[]>(untrack(() => [...presetSectionIds]));
	let selectedContentType = $state('');
	let silentMode = $state(false);
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let fieldErrors = $state<Record<string, string[]>>({});
	let hasClientFeedback = $state(false);
	let pasteHint = $state<string | null>(null);

	let checkingDuplicate = $state(false);
	let duplicateResult = $state<DuplicateCheckResult | null>(null);

	$effect(() => {
		hydrated = true;
		if (!initialValues) {
			return;
		}
		urlValue = initialValues.url ?? '';
		noteValue = initialValues.note ?? '';
		selectedSectionIds = initialValues.sectionIds ? [...initialValues.sectionIds] : [];
		selectedContentType = initialValues.contentType ?? '';
		silentMode = Boolean(initialValues.silentMode);
		errorMessage = initialValues.errorMessage ?? null;
		fieldErrors = initialValues.fieldErrors ?? {};
		hasClientFeedback = false;
	});

	// Suggested sections come first, marked, never pre-checked (smart capture §10).
	const suggestedSectionIds = $derived(
		new Set((duplicateResult?.suggestedSections ?? []).map((suggestion) => suggestion.id))
	);
	const orderedSections = $derived(
		[...sections].sort(
			(a, b) => Number(suggestedSectionIds.has(b.id)) - Number(suggestedSectionIds.has(a.id))
		)
	);

	const displayedErrorMessage = $derived(
		hasClientFeedback ? errorMessage : (errorMessage ?? initialValues?.errorMessage ?? null)
	);

	const displayedFieldErrors = $derived(
		hasClientFeedback
			? fieldErrors
			: Object.keys(fieldErrors).length > 0
				? fieldErrors
				: (initialValues?.fieldErrors ?? {})
	);

	function toggleSection(sectionId: string, checked: boolean): void {
		if (checked) {
			if (!selectedSectionIds.includes(sectionId)) {
				selectedSectionIds = [...selectedSectionIds, sectionId];
			}
		} else {
			selectedSectionIds = selectedSectionIds.filter((id) => id !== sectionId);
		}
	}

	const isDirty = $derived(
		urlValue.trim().length > 0 ||
			noteValue.trim().length > 0 ||
			selectedSectionIds.length > 0 ||
			selectedContentType !== '' ||
			silentMode
	);

	function resetForm(): void {
		urlValue = '';
		noteValue = '';
		selectedSectionIds = [...presetSectionIds];
		selectedContentType = '';
		silentMode = false;
		submitting = false;
		errorMessage = null;
		fieldErrors = {};
		hasClientFeedback = false;
		pasteHint = null;
		checkingDuplicate = false;
		duplicateResult = null;
	}

	function isValidHttpUrl(candidate: string): boolean {
		const trimmed = candidate.trim();
		if (!trimmed) {
			return false;
		}
		try {
			const parsed = new URL(trimmed);
			return parsed.protocol === 'http:' || parsed.protocol === 'https:';
		} catch {
			return false;
		}
	}

	function applySmartTextExtraction(rawText: string): boolean {
		const extracted = extractFirstUrlFromText(rawText);
		if (!extracted.url) {
			return false;
		}
		if (extracted.suggestedNote && rawText.trim() !== extracted.url) {
			urlValue = extracted.url;
			if (!noteValue.trim()) {
				noteValue = extracted.suggestedNote;
				pasteHint = t('composer.pastedWithNote');
			} else {
				pasteHint = t('composer.pastedFirstLink');
			}
			return true;
		}
		return false;
	}

	function handleUrlPaste(event: ClipboardEvent): void {
		const pasted = event.clipboardData?.getData('text/plain');
		if (!pasted) {
			return;
		}
		const extracted = extractFirstUrlFromText(pasted);
		if (extracted.url && pasted.trim() !== extracted.url) {
			event.preventDefault();
			urlValue = extracted.url;
			if (extracted.suggestedNote && !noteValue.trim()) {
				noteValue = extracted.suggestedNote;
				pasteHint = t('composer.pastedWithNote');
			} else {
				pasteHint = t('composer.pastedFirstLink');
			}
		} else {
			pasteHint = null;
		}
	}

	function handleUrlInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const nextValue = target.value;
		urlValue = nextValue;
		if (/\s/.test(nextValue.trim()) && applySmartTextExtraction(nextValue)) {
			return;
		}
		pasteHint = null;
	}

	$effect(() => {
		const active = open || inlineMode;
		const candidate = urlValue.trim();

		if (!active || !isValidHttpUrl(candidate)) {
			checkingDuplicate = false;
			duplicateResult = null;
			return;
		}

		const abortController = new AbortController();
		const timerId = window.setTimeout(async () => {
			checkingDuplicate = true;
			try {
				const response = await fetch(
					`/api/internal/links/check?url=${encodeURIComponent(candidate)}`,
					{
						method: 'GET',
						credentials: 'same-origin',
						signal: abortController.signal
					}
				);
				if (!response.ok) {
					duplicateResult = null;
					return;
				}
				const payload = (await response.json()) as DuplicateCheckResult;
				if (!abortController.signal.aborted) {
					duplicateResult = payload;
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					return;
				}
				duplicateResult = null;
			} finally {
				if (!abortController.signal.aborted) {
					checkingDuplicate = false;
				}
			}
		}, 300);

		return () => {
			window.clearTimeout(timerId);
			abortController.abort();
		};
	});

	function applyPrefill(next: { url: string; note: string | null }): void {
		urlValue = next.url;
		if (next.note && !noteValue.trim()) {
			noteValue = next.note;
		}
		let host = next.url;
		try {
			host = new URL(next.url).hostname.replace(/^www\./, '');
		} catch {
			// keep raw value
		}
		toasts.announce(t('composer.linkAdded', { host }));
		queueMicrotask(() => noteInputEl?.focus({ preventScroll: true }));
	}

	// The feed variant registers itself as the preferred target of every share trigger.
	$effect(() => {
		if (variant !== 'feed' || !controller || !rootEl) {
			return;
		}
		const element = rootEl;
		return controller.registerInline({
			element,
			focus: () => urlInputEl?.focus({ preventScroll: true }),
			fill: (next) => applyPrefill(next)
		});
	});

	let appliedPrefillSeq = 0;
	$effect(() => {
		if (variant === 'dialog' && open && prefill && prefill.seq !== appliedPrefillSeq) {
			appliedPrefillSeq = prefill.seq;
			applyPrefill(prefill);
		}
	});

	const handleSubmit: SubmitFunction = ({ cancel }) => {
		hasClientFeedback = true;
		errorMessage = null;
		fieldErrors = {};

		if (silentMode && selectedSectionIds.length === 0) {
			errorMessage = t('share.silentNeedsSection');
			fieldErrors = { sectionIds: [t('share.silentNeedsSection')] };
			cancel();
			return;
		}

		submitting = true;

		return async ({ result }) => {
			submitting = false;

			if (result.type === 'failure') {
				const data = result.data as
					| {
							errorMessage?: string;
							fieldErrors?: Record<string, string[]>;
					  }
					| undefined;
				errorMessage = data?.errorMessage ?? t('composer.shareFailed');
				fieldErrors = data?.fieldErrors ?? {};
				return;
			}

			if (result.type === 'error') {
				errorMessage = t('common.unexpected');
				return;
			}

			if (result.type === 'redirect') {
				resetForm();
				open = false;
				await goto(result.location, { refreshAll: true });
				return;
			}

			if (result.type === 'success') {
				const shareId = (result.data as { shareId?: unknown } | undefined)?.shareId;
				resetForm();
				open = false;
				toasts.push(t('composer.shared'), {
					tone: 'success',
					action:
						typeof shareId === 'string' && !navigateHomeOnSuccess
							? { label: t('composer.show'), href: `#share-${shareId}` }
							: undefined
				});
				await invalidate('app:feed');
				if (navigateHomeOnSuccess) {
					await goto('/');
				}
				if (variant === 'feed') {
					urlInputEl?.focus({ preventScroll: true });
				}
			}
		};
	};
</script>

{#snippet formContent(onCancelClick?: () => void)}
	<header class="composer-header">
		<h2 id={titleId} class="composer-title" class:visually-hidden={variant === 'feed'}>
			{t('nav.shareLink')}
		</h2>
		{#if onCancelClick}
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				aria-label={t('composer.close')}
				onclick={onCancelClick}
			>
				{t('common.close')}
			</button>
		{/if}
	</header>

	{#if displayedErrorMessage}
		<div class="composer-error" role="alert">
			{displayedErrorMessage}
		</div>
	{/if}

	<form
		method="POST"
		action="{actionUrl}?/createShare"
		use:enhance={handleSubmit}
		class="composer-form"
	>
		<input type="hidden" name="returnTo" value={returnTo} />

		<div class="field">
			<label for={urlInputId} class="field-label" class:visually-hidden={variant === 'feed'}>
				{t('composer.urlLabel')}
			</label>
			<div class="composer-url-row">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:this={urlInputEl}
					id={urlInputId}
					name="url"
					type="url"
					inputmode="url"
					required
					autofocus={!inlineMode}
					placeholder={variant === 'feed'
						? t('composer.urlPlaceholderFeed')
						: t('composer.urlPlaceholder')}
					autocorrect="off"
					autocapitalize="none"
					spellcheck="false"
					value={hydrated ? urlValue : (initialValues?.url ?? '')}
					onpaste={handleUrlPaste}
					oninput={handleUrlInput}
					aria-invalid={Boolean(displayedFieldErrors.url?.length) || undefined}
					aria-describedby={displayedFieldErrors.url?.length ? `${urlInputId}-err` : undefined}
					class="input url-input"
				/>
				{#if variant === 'feed'}
					<span class="kbd composer-kbd" aria-hidden="true">
						{shortcutLabel((page.data as { modifierKey?: ModifierKey }).modifierKey ?? 'meta', 'V')}
					</span>
				{/if}
			</div>
			{#if pasteHint}
				<p class="field-hint">{pasteHint}</p>
			{/if}
			{#if displayedFieldErrors.url?.length}
				<p id="{urlInputId}-err" class="field-error">{displayedFieldErrors.url[0]}</p>
			{/if}
		</div>

		<div class="composer-more">
			{#if checkingDuplicate}
				<p class="field-hint" role="status">{t('composer.checking')}</p>
			{:else if duplicateResult}
				{#if duplicateResult.exists && duplicateResult.sharesSummary}
					{@const summary = duplicateResult.sharesSummary}
					<div class="duplicate-banner" role="status">
						<p class="duplicate-heading">{t('composer.duplicate')}</p>
						{#if duplicateResult.resource?.title}
							<p class="duplicate-detail">
								{t('composer.dupTitle', { title: duplicateResult.resource.title })}
							</p>
						{/if}
						{#if duplicateResult.originalShareDeleted}
							<p class="duplicate-detail">
								{t('composer.dupOriginalDeleted', { count: summary.totalCount })}
							</p>
						{:else if summary.firstShare}
							<p class="duplicate-detail">
								{t('share.firstSharedBy')} <strong>{summary.firstShare.authorName}</strong> ·
								{formatShortDate(summary.firstShare.createdAt)}
								{t('composer.dupTotal', { count: summary.totalCount })}
							</p>
							{#if summary.firstShare.sectionNames.length > 0}
								<p class="duplicate-detail">
									{t('composer.dupSections', {
										sections: summary.firstShare.sectionNames.join(', ')
									})}
								</p>
							{/if}
							{#if !summary.firstShare.isFeedVisible}
								<p class="duplicate-detail">
									{t('composer.dupSilent')}
								</p>
							{/if}
						{/if}
						<p class="duplicate-note">{t('composer.dupStillShare')}</p>
					</div>
				{:else if duplicateResult.suggestedContentType}
					<p class="field-hint">
						{t('composer.suggestedType')}
						<strong>{contentTypeLabel(duplicateResult.suggestedContentType)}</strong>
					</p>
				{/if}
			{/if}

			<div class="field">
				<label for={noteInputId} class="field-label">{t('composer.noteLabel')}</label>
				<textarea
					bind:this={noteInputEl}
					id={noteInputId}
					name="note"
					rows="3"
					maxlength="1000"
					placeholder={t('composer.notePlaceholder')}
					value={hydrated ? noteValue : (initialValues?.note ?? '')}
					oninput={(e) => {
						noteValue = e.currentTarget.value;
					}}
					onkeydown={(e) => {
						// Ctrl/⌘ + Enter submits (izgah-ui-v2 §8.2); never while an IME is composing.
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
							e.preventDefault();
							e.currentTarget.form?.requestSubmit();
						}
					}}
					aria-invalid={Boolean(displayedFieldErrors.note?.length) || undefined}
					aria-describedby={displayedFieldErrors.note?.length ? `${noteInputId}-err` : undefined}
					class="textarea textarea-input"></textarea>
				{#if sections.length > 0}
					<p class="field-hint">{t('composer.hashtagHint')}</p>
				{/if}
				{#if displayedFieldErrors.note?.length}
					<p id="{noteInputId}-err" class="field-error">{displayedFieldErrors.note[0]}</p>
				{/if}
			</div>

			<fieldset class="sections-fieldset">
				<legend class="field-label">
					{t('share.sections')}
					{(hydrated ? silentMode : Boolean(initialValues?.silentMode))
						? t('share.sectionsRequired')
						: t('common.optionalParen')}
				</legend>
				{#if sections.length === 0}
					<p class="field-hint">{t('share.noSections')}</p>
				{:else}
					<div class="sections-grid">
						{#each orderedSections as section (section.id)}
							<label class="checkbox-row">
								<input
									type="checkbox"
									name="sectionIds"
									value={section.id}
									checked={hydrated
										? selectedSectionIds.includes(section.id)
										: initialValues
											? Boolean(initialValues.sectionIds?.includes(section.id))
											: presetSectionIds.includes(section.id)}
									onchange={(e) => toggleSection(section.id, e.currentTarget.checked)}
								/>
								<span>{section.name}</span>
								{#if suggestedSectionIds.has(section.id)}
									<span class="suggested-tag">{t('suggest.suggested')}</span>
								{/if}
							</label>
						{/each}
					</div>
				{/if}
				{#if displayedFieldErrors.sectionIds?.length}
					<p class="field-error">{displayedFieldErrors.sectionIds[0]}</p>
				{/if}
			</fieldset>

			<div class="field">
				<label for={typeSelectId} class="field-label">{t('share.contentType')}</label>
				<select
					id={typeSelectId}
					name="contentType"
					value={hydrated ? selectedContentType : (initialValues?.contentType ?? '')}
					onchange={(e) => {
						selectedContentType = e.currentTarget.value;
					}}
					class="select"
				>
					<option value="">{t('composer.autoDetect')}</option>
					<option value="article">{t('contentType.article')}</option>
					<option value="video">{t('contentType.video')}</option>
					<option value="repo">{t('contentType.repo')}</option>
					<option value="social">{t('contentType.social')}</option>
					<option value="web">{t('contentType.web')}</option>
				</select>
				{#if displayedFieldErrors.contentType?.length}
					<p class="field-error">{displayedFieldErrors.contentType[0]}</p>
				{/if}
			</div>

			{#if isAdmin}
				<label class="checkbox-row silent-checkbox">
					<input
						type="checkbox"
						name="silentMode"
						value="true"
						checked={hydrated ? silentMode : Boolean(initialValues?.silentMode)}
						onchange={(e) => {
							silentMode = e.currentTarget.checked;
						}}
					/>
					<span>{t('share.silentOption')}</span>
				</label>
			{/if}
		</div>

		<div class="composer-actions">
			{#if onCancelClick}
				<button type="button" class="btn btn-outline" onclick={onCancelClick}>
					{t('common.cancel')}
				</button>
			{/if}
			<button type="submit" class="btn btn-primary" disabled={submitting}>
				{submitting ? t('composer.sharing') : t('nav.share')}
			</button>
		</div>
	</form>
{/snippet}

{#if inlineMode}
	<section
		bind:this={rootEl}
		id="share-composer-inline"
		class="inline-composer-card is-feed"
		class:has-error={Boolean(displayedErrorMessage)}
		aria-labelledby={titleId}
	>
		{@render formContent(undefined)}
	</section>
{:else}
	<Dialog
		bind:open
		id="share-composer-dialog"
		{titleId}
		dirty={isDirty}
		guardUnsaved={true}
		closedby="closerequest"
		onDiscard={resetForm}
	>
		{#snippet children({ requestClose })}
			{@render formContent(() => requestClose('cancel'))}
		{/snippet}
	</Dialog>
{/if}

<style>
	/* Feed variant (izgah-ui-v5.md §5.3): a card collapsed to the URL row until focused, filled or
	   showing an error; it expands in place with the accent focus halo. */
	.inline-composer-card.is-feed {
		margin-block-end: var(--space-2);
		padding: var(--space-2);
		background: var(--card);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-xl);
		box-shadow: var(--elevation-sm);
		transition: box-shadow var(--dur-fast) var(--ease);
	}

	.inline-composer-card.is-feed:focus-within {
		box-shadow:
			0 0 0 1px color-mix(in oklab, var(--primary) 55%, transparent),
			0 0 0 4px color-mix(in oklab, var(--primary) 12%, transparent);
	}

	.is-feed:focus-within :global(.composer-more),
	.is-feed:focus-within .composer-actions {
		padding-inline: var(--space-2);
	}

	.is-feed .composer-header {
		display: contents;
	}

	.composer-url-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.is-feed .url-input {
		min-inline-size: 0;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
		text-overflow: ellipsis;
	}

	.is-feed .url-input::placeholder {
		text-overflow: ellipsis;
	}

	.is-feed .url-input:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.composer-kbd {
		flex: none;
	}

	.is-feed:focus-within .composer-kbd,
	.is-feed:has(input[name='url']:not(:placeholder-shown)) .composer-kbd,
	.is-feed.has-error .composer-kbd {
		display: none;
	}

	@media (pointer: coarse) {
		.composer-kbd {
			display: none;
		}
	}

	.is-feed :global(.composer-more),
	.is-feed .composer-actions {
		display: none;
	}

	.is-feed:focus-within :global(.composer-more),
	.is-feed:has(input[name='url']:not(:placeholder-shown)) :global(.composer-more),
	.is-feed.has-error :global(.composer-more) {
		display: grid;
		gap: var(--space-4);
	}

	.is-feed:focus-within .composer-actions,
	.is-feed:has(input[name='url']:not(:placeholder-shown)) .composer-actions,
	.is-feed.has-error .composer-actions {
		display: flex;
	}

	.composer-more {
		display: grid;
		gap: var(--space-4);
	}

	.composer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-4);
	}

	.composer-title {
		margin: 0;
		font: var(--k-text-section);
		font-size: 1.125rem;
		color: var(--k-color-text);
	}

	.composer-error {
		padding: var(--space-3) var(--space-4);
		margin-block-end: var(--space-4);
		border: 1px solid var(--k-color-danger-border);
		background: var(--k-color-danger-soft);
		color: var(--k-color-danger);
		border-radius: var(--k-radius-sm);
		font: var(--k-text-ui);
	}

	.composer-form {
		display: grid;
		gap: var(--space-4);
	}

	.is-feed .composer-form {
		gap: var(--space-3);
	}

	.textarea-input {
		min-block-size: 4.5rem;
		max-block-size: 14rem;
		block-size: auto;
		field-sizing: content;
	}

	.duplicate-banner {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--k-color-warn-border);
		background: var(--k-color-warn-soft);
		color: var(--k-color-text);
		border-radius: var(--k-radius-md);
		display: grid;
		gap: var(--space-1);
		font: var(--k-text-hint);
	}

	.duplicate-heading {
		margin: 0;
		font: var(--k-text-ui);
		font-weight: 600;
		color: var(--k-color-warn-text);
	}

	.duplicate-detail,
	.duplicate-note {
		margin: 0;
	}

	.duplicate-detail {
		font-variant-numeric: tabular-nums;
	}

	.sections-fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.sections-fieldset > legend {
		padding-inline: var(--space-1);
		margin-inline-start: calc(-1 * var(--space-1));
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
		font: var(--k-text-ui);
		color: var(--k-color-text);
		cursor: pointer;
	}

	.sections-grid .checkbox-row {
		padding: 0;
		color: var(--k-color-text);
	}

	.sections-grid .checkbox-row:hover {
		color: var(--k-color-text);
	}

	.sections-grid .checkbox-row:has(input:checked) {
		font-weight: 600;
	}

	.checkbox-row input[type='checkbox'] {
		inline-size: 1rem;
		block-size: 1rem;
		flex-shrink: 0;
	}

	.silent-checkbox {
		padding: var(--space-2) 0 0;
		border-block-start: 1px solid var(--k-color-line);
	}

	.composer-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-block-start: var(--space-1);
	}

	@media (forced-colors: active) {
		.inline-composer-card.is-feed {
			box-shadow: none;
			border-color: CanvasText;
		}
	}

	@media (pointer: coarse) {
		.checkbox-row {
			min-block-size: 44px;
		}
	}
	.suggested-tag {
		font: var(--k-text-hint);
		color: var(--k-color-accent-text);
	}
</style>
