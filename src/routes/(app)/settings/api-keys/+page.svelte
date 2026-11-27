<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle, sourceUrl } from '#lib/instance.ts';
	import { page } from '$app/state';
	import { formatWhen } from '#lib/format/date.ts';
	import { enhance } from '$app/forms';
	import Dialog from '#lib/components/platform/Dialog.svelte';
	import type { ActionData, PageData } from './$types';

	interface CommandLikeEvent extends Event {
		command?: string;
		source?: HTMLElement | null;
	}

	interface PendingRevokeKey {
		id: string;
		name: string;
		keyPrefix: string;
	}

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let createFormEl = $state<HTMLFormElement | null>(null);
	let nameInvalid = $state(false);
	let creating = $state(false);
	let revoking = $state(false);
	let liveAnnouncement = $state('');
	let announcementToggle = false;

	let codeEl = $state<HTMLElement | null>(null);
	let copyBtnEl = $state<HTMLButtonElement | null>(null);
	let copyTipVisible = $state(false);
	let copyStatusText = $state('');
	let copyToggle = false;
	let copyTimer: number | undefined;

	let revokeDialogOpen = $state(false);
	let pendingRevoke = $state<PendingRevokeKey | null>(null);
	const atKeyLimit = $derived(data.apiKeys.length >= data.maxKeys);

	function formatDate(value: Date | string | null): string {
		if (!value) {
			return t('apiKeys.neverUsed');
		}
		const date = value instanceof Date ? value : new Date(value);
		return formatWhen(date);
	}

	function isControlUserInvalid(
		control: HTMLInputElement,
		supportsUserInvalid: boolean,
		dirtyFields: WeakSet<HTMLInputElement>
	): boolean {
		if (supportsUserInvalid) {
			try {
				return control.matches(':user-invalid');
			} catch {
				return dirtyFields.has(control) && !control.validity.valid;
			}
		}
		return dirtyFields.has(control) && !control.validity.valid;
	}

	function syncControlAccessibility(
		control: HTMLInputElement,
		supportsUserInvalid: boolean,
		dirtyFields: WeakSet<HTMLInputElement>
	): { invalid: boolean; message: string } {
		const invalid = isControlUserInvalid(control, supportsUserInvalid, dirtyFields);
		if (!supportsUserInvalid) {
			control.classList.toggle('user-invalid-fallback', invalid);
		}
		control.setAttribute('aria-invalid', invalid ? 'true' : 'false');

		const hintId = control.dataset.hint;
		const errorId = control.dataset.error;
		const describedBy = [hintId, ...(invalid && errorId ? [errorId] : [])].filter(Boolean);
		if (describedBy.length > 0) {
			control.setAttribute('aria-describedby', describedBy.join(' '));
		} else {
			control.removeAttribute('aria-describedby');
		}

		let message = '';
		if (invalid && errorId) {
			const errorEl = document.getElementById(errorId);
			message = errorEl?.dataset.message ?? '';
		}
		return { invalid, message };
	}

	$effect(() => {
		const formNode = createFormEl;
		if (!formNode) {
			return;
		}

		const supportsUserInvalid =
			typeof CSS !== 'undefined' && CSS.supports('selector(:user-invalid)');
		const dirtyFields = new WeakSet<HTMLInputElement>();
		const timers = new WeakMap<HTMLInputElement, number>();
		const controls = Array.from(formNode.querySelectorAll<HTMLInputElement>('input[data-error]'));

		const syncState = (control: HTMLInputElement) => {
			const result = syncControlAccessibility(control, supportsUserInvalid, dirtyFields);
			if (control.name === 'name') {
				nameInvalid = result.invalid;
			}
			return result;
		};

		const scheduleAnnouncement = (control: HTMLInputElement) => {
			const existingTimer = timers.get(control);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
			}
			const timer = window.setTimeout(() => {
				const { invalid, message } = syncState(control);
				if (invalid && message) {
					announcementToggle = !announcementToggle;
					liveAnnouncement = announcementToggle ? message : `${message}\u00A0`;
				}
			}, 500);
			timers.set(control, timer);
		};

		const handleInput = (event: Event) => {
			const target = event.currentTarget;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}
			if (target.value.length > 0) {
				dirtyFields.add(target);
			}
			syncState(target);
		};

		const handleBlurOrChange = (event: Event) => {
			const target = event.currentTarget;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}
			dirtyFields.add(target);
			syncState(target);
			scheduleAnnouncement(target);
		};

		const handleInvalid = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}
			dirtyFields.add(target);
			syncState(target);
		};

		for (const control of controls) {
			control.setAttribute('aria-invalid', 'false');
			control.addEventListener('input', handleInput);
			control.addEventListener('blur', handleBlurOrChange);
			control.addEventListener('change', handleBlurOrChange);
		}
		formNode.addEventListener('invalid', handleInvalid, true);

		return () => {
			for (const control of controls) {
				const timer = timers.get(control);
				if (timer !== undefined) {
					window.clearTimeout(timer);
				}
				control.removeEventListener('input', handleInput);
				control.removeEventListener('blur', handleBlurOrChange);
				control.removeEventListener('change', handleBlurOrChange);
			}
			formNode.removeEventListener('invalid', handleInvalid, true);
		};
	});

	async function performCopy(text: string): Promise<void> {
		if (!text) {
			return;
		}
		if (copyTimer !== undefined) {
			window.clearTimeout(copyTimer);
		}
		copyToggle = !copyToggle;

		try {
			await navigator.clipboard.writeText(text);
			copyStatusText = copyToggle ? t('apiKeys.copied') : `${t('apiKeys.copied')}\u00A0`;
		} catch {
			copyStatusText = copyToggle ? t('apiKeys.copyFailed') : `${t('apiKeys.copyFailed')}\u00A0`;
		}

		copyTipVisible = true;
		copyTimer = window.setTimeout(() => {
			copyTipVisible = false;
		}, 1500);
	}

	$effect(() => {
		const targetEl = codeEl;
		const buttonEl = copyBtnEl;
		if (!targetEl || !buttonEl) {
			return;
		}

		const handleCommand = (event: Event) => {
			const cmdEvent = event as CommandLikeEvent;
			if (cmdEvent.command !== '--copy') {
				return;
			}
			void performCopy(targetEl.textContent?.trim() ?? '');
		};

		const handleClickFallback = () => {
			void performCopy(targetEl.textContent?.trim() ?? '');
		};

		targetEl.addEventListener('command', handleCommand, true);
		const supportsCommandInvoker = 'CommandEvent' in window;
		if (!supportsCommandInvoker) {
			buttonEl.addEventListener('click', handleClickFallback);
		}

		return () => {
			targetEl.removeEventListener('command', handleCommand, true);
			if (!supportsCommandInvoker) {
				buttonEl.removeEventListener('click', handleClickFallback);
			}
			if (copyTimer !== undefined) {
				window.clearTimeout(copyTimer);
			}
		};
	});

	function openRevokeDialog(key: PendingRevokeKey): void {
		pendingRevoke = key;
		revokeDialogOpen = true;
	}

	function handleRevokeDialogClose(): void {
		pendingRevoke = null;
	}
</script>

<svelte:head>
	<title>{pageTitle(t('apiKeys.title'))}</title>
</svelte:head>

<div class="settings-container">
	<header class="page-head">
		<div class="page-head-copy">
			<h1 tabindex="-1">{t('apiKeys.title')}</h1>
			<p class="lead">
				{t('apiKeys.lead', { max: data.maxKeys })}
			</p>
		</div>
		<span class="badge badge-accent">
			{t('apiKeys.activeOf', { count: data.apiKeys.length, max: data.maxKeys })}
		</span>
	</header>

	<nav aria-label={t('settings.nav')} class="settings-subnav">
		<a href="/settings">{t('settings.title')}</a>
		<a href="/settings/api-keys" aria-current="page">{t('page.apiKeys')}</a>
	</nav>

	{#if form?.createdKey}
		<section class="secret-box" aria-labelledby="new-key-heading">
			<div class="secret-head">
				<h2 id="new-key-heading">{t('apiKeys.created', { name: form.createdKey.name })}</h2>
			</div>
			<p class="secret-warning">
				{t('apiKeys.showOnce')}
			</p>
			<div class="secret-row">
				<code bind:this={codeEl} id="new-api-key-value">{form.createdKey.rawKey}</code>
				<span class="copy-control">
					<button
						bind:this={copyBtnEl}
						type="button"
						class="btn btn-primary btn-sm"
						command="--copy"
						commandfor="new-api-key-value"
					>
						<span>{t('apiKeys.copy')}</span>
					</button>
					<span class="tip" class:visible={copyTipVisible} role="status">{copyStatusText}</span>
				</span>
			</div>
		</section>
	{/if}

	{#if form?.revokedKeyId}
		<div class="banner banner-success" role="status">
			<span>{t('apiKeys.revoked')}</span>
		</div>
	{/if}

	{#if form?.revokeError}
		<div class="banner banner-error" role="alert">
			<span>{form.revokeError}</span>
		</div>
	{/if}

	<section class="settings-section" aria-labelledby="extension-heading">
		<h2 id="extension-heading" class="section-title">{t('apiKeys.extensionTitle')}</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<label for="instance-origin" class="settings-row-title">
						{t('apiKeys.serverAddress')}
					</label>
					<p id="instance-origin-hint" class="field-hint">{t('apiKeys.extensionStep')}</p>
				</div>
				<div class="settings-row-control extension-control">
					<input
						id="instance-origin"
						class="input instance-origin"
						type="url"
						readonly
						value={page.url.origin}
						aria-describedby="instance-origin-hint"
						onfocus={(event) => event.currentTarget.select()}
					/>
					<a
						href={`${sourceUrl()}/tree/main/extensions#readme`}
						class="btn btn-subtle btn-sm"
						rel="noopener noreferrer"
						target="_blank"
					>
						<span>{t('apiKeys.extensionGuide')}</span>
					</a>
				</div>
			</div>
		</div>
	</section>

	<section class="settings-section" aria-labelledby="create-key-heading">
		<h2 id="create-key-heading" class="section-title">{t('apiKeys.createHeading')}</h2>

		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('apiKeys.access')}</p>
					<p class="field-hint">
						{t('apiKeys.accessHint')}
					</p>
				</div>

				<div class="settings-row-control create-column">
					{#if form?.createError}
						<div class="banner banner-error" role="alert">
							<span>{form.createError}</span>
						</div>
					{/if}

					{#if atKeyLimit}
						<p class="banner banner-warn">
							<span>
								{t('apiKeys.limitReached', { max: data.maxKeys })}
							</span>
						</p>
					{/if}

					<form
						bind:this={createFormEl}
						method="POST"
						action="?/create"
						class="create-form"
						use:enhance={() => {
							creating = true;
							return async ({ result, update }) => {
								await update({ reset: result.type === 'success' });
								if (result.type === 'success') {
									nameInvalid = false;
								}
								creating = false;
							};
						}}
					>
						<div class="field" class:is-invalid={nameInvalid}>
							<label for="key-name">{t('apiKeys.name')}</label>
							<p id="key-name-hint" class="field-hint">
								{t('apiKeys.nameHint')}
							</p>
							<input
								id="key-name"
								name="name"
								type="text"
								maxlength="80"
								required
								disabled={atKeyLimit}
								aria-invalid="false"
								aria-describedby="key-name-hint"
								data-hint="key-name-hint"
								data-error="key-name-error"
								value={form?.name ?? ''}
								class="input"
							/>
							<p
								id="key-name-error"
								class="field-error error-msg"
								data-message={t('apiKey.nameEmpty')}
							>
								<span>{t('apiKey.nameEmpty')}</span>
							</p>
						</div>

						<div>
							<button type="submit" class="btn btn-primary" disabled={creating || atKeyLimit}>
								{creating ? t('apiKeys.creating') : t('apiKeys.createHeading')}
							</button>
						</div>

						<div class="visually-hidden" aria-live="polite">{liveAnnouncement}</div>
					</form>
				</div>
			</div>
		</div>
	</section>

	<section class="table-card" aria-labelledby="active-keys-heading">
		<header class="table-toolbar">
			<h2 id="active-keys-heading" class="section-title-plain">{t('apiKeys.active')}</h2>
			<span class="toolbar-count">{t('common.records', { count: data.apiKeys.length })}</span>
		</header>

		{#if data.apiKeys.length === 0}
			<p class="empty-state">{t('apiKeys.empty')}</p>
		{:else}
			<ul class="key-list" role="list">
				{#each data.apiKeys as key (key.id)}
					<li class="key-item">
						<div class="key-meta">
							<div class="key-title-row">
								<strong class="key-name">{key.name}</strong>
								<code class="key-prefix">{key.keyPrefix}…</code>
								<span class="status-pill status-active">
									<span class="status-dot" aria-hidden="true"></span>
									<span>{t('apiKeys.statusActive')}</span>
								</span>
							</div>
							<p class="key-dates">
								{t('apiKeys.dates', {
									created: formatDate(key.createdAt),
									used: formatDate(key.lastUsedAt)
								})}
							</p>
						</div>
						<button
							type="button"
							class="btn btn-danger-soft btn-sm"
							onclick={() =>
								openRevokeDialog({
									id: key.id,
									name: key.name,
									keyPrefix: key.keyPrefix
								})}
						>
							{t('apiKeys.revoke')}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<Dialog
	bind:open={revokeDialogOpen}
	titleId="revoke-dialog-title"
	onClose={handleRevokeDialogClose}
>
	{#snippet children({ closeNow })}
		<h2 id="revoke-dialog-title" class="dialog-title">{t('apiKeys.revokeTitle')}</h2>
		{#if pendingRevoke}
			<p class="dialog-body">
				{t('apiKeys.revokeConfirm', { name: pendingRevoke.name, prefix: pendingRevoke.keyPrefix })}
			</p>
		{/if}
		<form
			method="POST"
			action="?/revoke"
			use:enhance={() => {
				revoking = true;
				return async ({ update }) => {
					await update();
					revoking = false;
					closeNow('confirmed');
				};
			}}
		>
			<input type="hidden" name="keyId" value={pendingRevoke?.id ?? ''} />
			<div class="dialog-actions">
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="btn btn-subtle" autofocus onclick={() => closeNow('cancel')}>
					{t('common.cancel')}
				</button>
				<button type="submit" class="btn btn-danger" disabled={revoking}>
					{revoking ? t('apiKeys.revoking') : t('apiKeys.revokeKey')}
				</button>
			</div>
		</form>
	{/snippet}
</Dialog>

<style>
	.settings-container {
		max-inline-size: var(--wide-w);
		display: grid;
		gap: var(--space-6);
	}

	.page-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.page-head-copy {
		display: grid;
		gap: var(--space-1);
		min-inline-size: 0;
	}

	h1 {
		font: var(--type-display);
		letter-spacing: -0.02em;
		color: var(--foreground);
	}

	.lead {
		margin: 0;
		font: var(--type-ui);
		font-weight: 400;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	/* Page tabs as a segmented control (izgah-ui-v5.md §5.6). */
	.settings-subnav {
		display: inline-flex;
		justify-self: start;
		flex-wrap: wrap;
		gap: 2px;
		padding: 3px;
		background: var(--muted);
		border-radius: 10px;
	}

	.settings-subnav a {
		display: inline-flex;
		align-items: center;
		min-block-size: 30px;
		padding: 0 12px;
		font: var(--type-ui);
		color: var(--muted-foreground);
		text-decoration: none;
		border-radius: 7px;
		transition:
			color var(--dur-fast) var(--ease),
			background-color var(--dur-fast) var(--ease);
	}

	.settings-subnav a:not([aria-current='page']):hover {
		color: var(--foreground);
		text-decoration: none;
	}

	.settings-subnav a[aria-current='page'],
	.settings-subnav a[aria-current='page']:hover {
		color: var(--foreground);
		background: var(--background);
		box-shadow: var(--elevation-sm);
		text-decoration: none;
	}

	@media (pointer: coarse) {
		.settings-subnav a {
			min-block-size: 44px;
		}
	}

	/* Strict serif boundary: all h2 subheadings stay --font-sans (--type-section). */
	.extension-control {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	.instance-origin {
		inline-size: 100%;
		font-family: var(--font-mono);
	}

	/* Each group is a card with a titled header (izgah-ui-v5.md §5.6). */
	.settings-section {
		display: grid;
		min-inline-size: 0;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-sm);
	}

	.section-title {
		font: var(--type-section);
		color: var(--foreground);
		padding: 14px 20px;
		border-block-end: 1px solid var(--hairline);
	}

	.section-title-plain {
		font: var(--type-section);
		color: var(--foreground);
	}

	.settings-rows {
		display: grid;
		padding-inline: 20px;
	}

	.settings-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding-block: 18px;
		align-items: start;
	}

	@media (min-width: 768px) {
		.settings-row {
			grid-template-columns: 240px minmax(0, 1fr);
			gap: var(--space-5);
		}
	}

	.settings-row-info {
		display: grid;
		gap: 4px;
		min-inline-size: 0;
	}

	.settings-row-title {
		font: var(--type-ui);
		font-weight: 600;
		color: var(--foreground);
	}

	.create-column {
		display: grid;
		gap: var(--space-3);
		min-inline-size: 0;
		max-inline-size: 28rem;
	}

	/* One-time secret box: distinct accent-soft Studio alert surface. */
	.secret-box {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--primary) 40%, transparent);
		border-radius: 12px;
	}

	@media (min-width: 640px) {
		.secret-box {
			padding: var(--space-5);
		}
	}

	.secret-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--link);
	}

	.secret-box h2 {
		font: var(--type-section);
		color: var(--link);
	}

	.secret-warning {
		font: var(--type-hint);
		color: var(--foreground);
	}

	.secret-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.secret-row code {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		padding: var(--space-2) var(--space-3);
		color: var(--foreground);
		background: var(--card);
		border: 1px solid color-mix(in oklab, var(--primary) 40%, transparent);
		border-radius: 6px;
		word-break: break-all;
	}

	.copy-control {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.tip {
		opacity: 0;
		pointer-events: none;
		font: var(--type-ui);
		font-weight: 600;
		color: var(--link);
		transition: opacity var(--dur-fast) var(--ease);
	}

	.tip.visible {
		opacity: 1;
	}

	.create-form {
		display: grid;
		gap: var(--space-4);
	}

	.field input:is(:user-invalid, :global(.user-invalid-fallback)),
	.field.is-invalid input {
		border-color: var(--destructive);
	}

	.error-msg {
		display: none;
		align-items: center;
		gap: var(--space-1);
	}

	.field:has(:is(:user-invalid, :global(.user-invalid-fallback))) .error-msg,
	.field.is-invalid .error-msg {
		display: flex;
	}

	/* Studio table-card for active API keys. */
	.table-card {
		overflow: hidden;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-sm);
	}

	.table-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-block-end: 1px solid var(--border);
	}

	.toolbar-count {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.empty-state {
		padding: var(--space-5) var(--space-4);
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.key-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}

	.key-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		border-block-end: 1px solid var(--border);
		transition: background-color var(--dur-fast) var(--ease);
	}

	.key-item:last-child {
		border-block-end: 0;
	}

	.key-item:hover {
		background: var(--muted);
	}

	.key-meta {
		display: grid;
		gap: 4px;
		min-inline-size: 0;
	}

	.key-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.key-name {
		font: var(--type-ui);
		font-weight: 600;
		color: var(--foreground);
	}

	.key-prefix {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		padding: 1px 7px;
		color: var(--muted-foreground);
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: 4px;
	}

	.key-dates {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.dialog-title {
		font: var(--type-section);
		font-size: 1.125rem;
		margin-block-end: var(--space-3);
		color: var(--foreground);
	}

	.dialog-body {
		margin-block-end: var(--space-4);
		color: var(--muted-foreground);
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	@media (forced-colors: active) {
		.settings-subnav a[aria-current='page'],
		.settings-subnav a[aria-current='page']:hover {
			border-block-end-color: Highlight;
			color: Highlight;
		}

		.table-card,
		.secret-box {
			box-shadow: none;
		}
	}
</style>
