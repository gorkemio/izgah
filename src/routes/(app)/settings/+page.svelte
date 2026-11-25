<script lang="ts">
	import { getLocale, LOCALE_NATIVE_NAMES, LOCALES, t } from '$lib/i18n';
	import { instanceName, pageTitle, sourceUrl } from '$lib/instance';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import PaletteForm from '$lib/components/shell/PaletteForm.svelte';
	import ThemeForm from '$lib/components/shell/ThemeForm.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { getShortcutPreference } from '$lib/client/shortcuts.svelte';
	import type { ThemeChoice } from '$lib/client/theme.svelte';
	import { DEFAULT_PALETTE, type Palette } from '$lib/types/appearance';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const shortcutPreference = getShortcutPreference();
	const currentLocale = getLocale();
	// The layout loads the theme cookie for every app page.
	const themeChoice = $derived((page.data as { theme?: ThemeChoice }).theme ?? 'system');
	const palette = $derived((page.data as { palette?: Palette }).palette ?? DEFAULT_PALETTE);

	let formEl = $state<HTMLFormElement | null>(null);
	let showCurrentPassword = $state(false);
	let showNewPassword = $state(false);
	let submitting = $state(false);
	let currentInvalid = $state(false);
	let newInvalid = $state(false);
	let liveAnnouncement = $state('');
	let announcementToggle = false;

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
		const formNode = formEl;
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
			if (control.name === 'currentPassword') {
				currentInvalid = result.invalid;
			} else if (control.name === 'newPassword') {
				newInvalid = result.invalid;
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
</script>

<svelte:head>
	<title>{pageTitle(t('settings.title'))}</title>
</svelte:head>

<div class="settings-page">
	<header class="page-head">
		<h1 tabindex="-1">{t('settings.title')}</h1>
		<p class="page-subtitle">
			{t('settings.lead')}
		</p>
	</header>

	<nav aria-label={t('settings.nav')} class="settings-subnav">
		<a href="/settings" aria-current="page">{t('settings.title')}</a>
		<a href="/settings/api-keys">{t('page.apiKeys')}</a>
	</nav>

	<section class="settings-section" aria-labelledby="profile-heading">
		<h2 id="profile-heading" class="section-title">{t('settings.profile')}</h2>
		<dl class="settings-rows">
			<div class="settings-row">
				<dt class="settings-row-info">
					<span class="settings-row-title">{t('settings.name')}</span>
					<span class="field-hint">{t('settings.nameHint')}</span>
				</dt>
				<dd class="settings-row-control profile-identity">
					<Avatar name={data.user.name} self size={28} />
					<span class="profile-value">{data.user.name}</span>
				</dd>
			</div>
			<div class="settings-row">
				<dt class="settings-row-info">
					<span class="settings-row-title">{t('settings.email')}</span>
					<span class="field-hint">{t('settings.emailHint')}</span>
				</dt>
				<dd class="settings-row-control">
					<span class="profile-email">{data.user.email}</span>
				</dd>
			</div>
			<div class="settings-row">
				<dt class="settings-row-info">
					<span class="settings-row-title">{t('settings.role')}</span>
					<span class="field-hint">{t('settings.roleHint')}</span>
				</dt>
				<dd class="settings-row-control">
					{#if data.user.role === 'admin'}
						<span class="status-pill status-active">
							<span class="status-dot" aria-hidden="true"></span>
							<span>{t('role.admin')}</span>
						</span>
					{:else}
						<span class="badge">{t('role.member')}</span>
					{/if}
				</dd>
			</div>
		</dl>
	</section>

	<section class="settings-section" aria-labelledby="appearance-heading">
		<h2 id="appearance-heading" class="section-title">{t('settings.appearance')}</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.colorMode')}</p>
					<p class="field-hint">
						{t('settings.colorModeHint')}
					</p>
				</div>
				<div class="settings-row-control">
					<ThemeForm theme={themeChoice} variant="segmented" legend={t('settings.modeLegend')} />
				</div>
			</div>

			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.palette')}</p>
					<p class="field-hint">
						{t('settings.paletteHint')}
					</p>
				</div>
				<div class="settings-row-control palette-slot">
					<PaletteForm {palette} />
				</div>
			</div>

			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title" id="language-heading">{t('settings.language')}</p>
					<p class="field-hint">{t('settings.languageHint')}</p>
				</div>
				<div class="settings-row-control">
					<!-- Plain POST + 303: the page reloads in the new language (izgah-i18n-oss.md §2). -->
					<form method="POST" action="?/setLocale" class="locale-form">
						<fieldset class="segmented locale-options" aria-labelledby="language-heading">
							{#each LOCALES as code (code)}
								<label class="seg-item" class:is-active={currentLocale === code}>
									<input
										type="radio"
										name="locale"
										value={code}
										lang={code}
										checked={currentLocale === code}
										onchange={(event) => event.currentTarget.form?.requestSubmit()}
									/>
									<span lang={code}>{LOCALE_NATIVE_NAMES[code]}</span>
								</label>
							{/each}
						</fieldset>
						<noscript
							><button type="submit" class="btn btn-outline">{t('common.apply')}</button></noscript
						>
					</form>
				</div>
			</div>

			{#if shortcutPreference}
				<div class="settings-row">
					<div class="settings-row-info">
						<label for="single-key-shortcuts" class="settings-row-title"
							>{t('settings.shortcuts')}</label
						>
						<p id="single-key-shortcuts-hint" class="field-hint">
							{t('settings.shortcutsHint')}
						</p>
					</div>
					<div class="settings-row-control toggle-row">
						<span class="toggle-status">
							{shortcutPreference.enabled ? t('settings.shortcutsOn') : t('settings.shortcutsOff')}
						</span>
						<input
							id="single-key-shortcuts"
							type="checkbox"
							class="switch-input"
							aria-describedby="single-key-shortcuts-hint"
							checked={shortcutPreference.enabled}
							onchange={(event) => shortcutPreference.set(event.currentTarget.checked)}
						/>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<section class="settings-section" aria-labelledby="password-heading">
		<h2 id="password-heading" class="section-title">{t('settings.password')}</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.sessionSecurity')}</p>
					<p class="field-hint">
						{t('settings.sessionSecurityHint')}
					</p>
				</div>

				<div class="settings-row-control password-column">
					{#if form?.passwordChanged}
						<p class="banner banner-success" role="status">
							<Icon name="check" size={16} />
							<span>{form.message}</span>
						</p>
					{/if}

					{#if form?.error}
						<p class="banner banner-error" role="alert">
							<Icon name="alert" size={16} />
							<span>{form.error}</span>
						</p>
					{/if}

					<form
						bind:this={formEl}
						method="POST"
						action="?/changePassword"
						class="password-form"
						use:enhance={() => {
							submitting = true;
							return async ({ result, update }) => {
								await update({ reset: result.type === 'success' });
								if (result.type === 'success') {
									currentInvalid = false;
									newInvalid = false;
								}
								submitting = false;
							};
						}}
					>
						<input
							type="email"
							autocomplete="username"
							value={data.user.email}
							readonly
							tabindex="-1"
							class="visually-hidden"
							aria-hidden="true"
						/>

						<div class="field" class:is-invalid={currentInvalid}>
							<label for="currentPassword">{t('settings.currentPassword')}</label>
							<p id="current-password-hint" class="field-hint">
								{t('settings.currentPasswordHint')}
							</p>
							<div class="password-row">
								<input
									id="currentPassword"
									name="currentPassword"
									type={showCurrentPassword ? 'text' : 'password'}
									autocomplete="current-password"
									required
									aria-invalid="false"
									aria-describedby="current-password-hint"
									data-hint="current-password-hint"
									data-error="current-password-error"
									class="input"
								/>
								<button
									type="button"
									class="btn btn-subtle password-toggle"
									aria-pressed={showCurrentPassword}
									aria-controls="currentPassword"
									onclick={() => (showCurrentPassword = !showCurrentPassword)}
								>
									<Icon name={showCurrentPassword ? 'eyeOff' : 'eye'} size={15} />
									<span>{showCurrentPassword ? t('common.hide') : t('common.show')}</span>
								</button>
							</div>
							<p
								id="current-password-error"
								class="field-error error-msg"
								data-message={t('settings.currentPasswordRequired')}
							>
								{t('settings.currentPasswordRequired')}
							</p>
						</div>

						<div class="field" class:is-invalid={newInvalid}>
							<label for="newPassword">{t('settings.newPassword')}</label>
							<p id="new-password-hint" class="field-hint">
								{t('settings.newPasswordHint')}
							</p>
							<div class="password-row">
								<input
									id="newPassword"
									name="newPassword"
									type={showNewPassword ? 'text' : 'password'}
									autocomplete="new-password"
									minlength="10"
									maxlength="128"
									required
									aria-invalid="false"
									aria-describedby="new-password-hint"
									data-hint="new-password-hint"
									data-error="new-password-error"
									class="input"
								/>
								<button
									type="button"
									class="btn btn-subtle password-toggle"
									aria-pressed={showNewPassword}
									aria-controls="newPassword"
									onclick={() => (showNewPassword = !showNewPassword)}
								>
									<Icon name={showNewPassword ? 'eyeOff' : 'eye'} size={15} />
									<span>{showNewPassword ? t('common.hide') : t('common.show')}</span>
								</button>
							</div>
							<p
								id="new-password-error"
								class="field-error error-msg"
								data-message={t('settings.newPasswordLength')}
							>
								{t('settings.newPasswordLength')}
							</p>
						</div>

						<div>
							<button type="submit" class="btn btn-primary" disabled={submitting}>
								{submitting ? t('settings.updating') : t('settings.updatePassword')}
							</button>
						</div>

						<div class="visually-hidden" aria-live="polite">{liveAnnouncement}</div>
					</form>
				</div>
			</div>
		</div>
	</section>

	<!-- On phones the rail's account menu is gone; its remaining duties live here (§6). -->
	<section class="settings-section session-panel" aria-labelledby="session-heading">
		<h2 id="session-heading" class="section-title">{t('settings.session')}</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.access')}</p>
					<p class="field-hint">{t('settings.accessHint')}</p>
				</div>
				<div class="settings-row-control session-actions">
					{#if data.user.role === 'admin'}
						<a href="/admin/users" class="btn btn-subtle">
							<Icon name="shield" size={15} />
							<span>{t('settings.adminPanel')}</span>
						</a>
					{/if}
					<form method="POST" action="/logout">
						<button type="submit" class="btn btn-danger-soft">
							<Icon name="logout" size={15} />
							<span>{t('settings.signOut')}</span>
						</button>
					</form>
				</div>
			</div>
		</div>
	</section>

	<section class="settings-section" aria-labelledby="about-heading">
		<h2 id="about-heading" class="section-title">{t('settings.about')}</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.software', { name: instanceName() })}</p>
					<p class="field-hint">{t('settings.softwareHint')}</p>
				</div>
				<div class="settings-row-control">
					<a href={sourceUrl()} class="btn btn-subtle" rel="noopener noreferrer" target="_blank">
						<Icon name="external" size={15} />
						<span>{t('settings.sourceCode')}</span>
					</a>
				</div>
			</div>
		</div>
	</section>
</div>

<style>
	.settings-page {
		display: grid;
		gap: var(--space-6);
		max-inline-size: var(--wide-w);
	}

	.page-head {
		display: grid;
		gap: var(--space-1);
	}

	h1 {
		font: var(--text-display);
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.page-subtitle {
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text-muted);
	}

	/* Underline subtabs: calm Studio indicator, zero loud neon block. */
	.settings-subnav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		border-block-end: 1px solid var(--color-line);
	}

	.settings-subnav a {
		display: inline-flex;
		align-items: center;
		min-block-size: 38px;
		padding: var(--space-2) var(--space-3) 10px;
		margin-block-end: -1px;
		font: var(--text-ui);
		color: var(--color-text-muted);
		text-decoration: none;
		border-block-end: 2px solid transparent;
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.settings-subnav a:not([aria-current='page']):hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.settings-subnav a[aria-current='page'],
	.settings-subnav a[aria-current='page']:hover {
		color: var(--color-text);
		font-weight: 600;
		border-block-end-color: var(--color-accent);
		text-decoration: none;
	}

	@media (pointer: coarse) {
		.settings-subnav a {
			min-block-size: 44px;
		}
	}

	/* Strict serif boundary: section h2 stays --font-sans (--text-section). */
	.settings-section {
		display: grid;
		gap: var(--space-2);
		min-inline-size: 0;
	}

	.section-title {
		font: var(--text-section);
		color: var(--color-text);
		padding-block-end: var(--space-2);
		border-block-end: 1px solid var(--color-line);
	}

	.settings-rows {
		display: grid;
		margin: 0;
	}

	.settings-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding-block: var(--space-5);
		border-block-end: 1px solid var(--color-line);
		align-items: start;
	}

	.settings-row:last-child {
		border-block-end: 0;
		padding-block-end: 0;
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
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.settings-row-control {
		min-inline-size: 0;
	}

	.profile-identity {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.profile-value {
		font: var(--text-body);
		font-weight: 500;
		color: var(--color-text);
	}

	.profile-email {
		font: var(--text-meta);
		font-size: 0.84375rem;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.palette-slot :global(.palette-form) {
		margin-block-start: 0;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.toggle-status {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	/* Native checkbox styled as a tactile Studio toggle switch (real focus & forced-colors). */
	.switch-input {
		appearance: none;
		position: relative;
		inline-size: 40px;
		block-size: 24px;
		flex: none;
		margin: 0;
		border-radius: var(--radius-pill);
		background: var(--color-surface-3);
		border: 1px solid var(--color-line-strong);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.switch-input::after {
		content: '';
		position: absolute;
		inset-block-start: 3px;
		inset-inline-start: 3px;
		inline-size: 16px;
		block-size: 16px;
		border-radius: var(--radius-pill);
		background: var(--color-surface-1);
		box-shadow: var(--shadow-xs);
		transition: translate var(--dur-fast) var(--ease);
	}

	.switch-input:checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.switch-input:checked::after {
		background: var(--color-on-accent);
		translate: 16px 0;
	}

	.password-column {
		display: grid;
		gap: var(--space-4);
		max-inline-size: 28rem;
	}

	.password-form {
		display: grid;
		gap: var(--space-4);
	}

	.password-row {
		display: flex;
		gap: var(--space-2);
	}

	.password-row .input {
		flex: 1;
		min-inline-size: 0;
	}

	.password-toggle {
		flex: none;
	}

	.field.is-invalid input,
	.password-row input:global(.user-invalid-fallback) {
		border-color: var(--color-danger);
	}

	/* Shown only after interaction (:user-invalid or the JS fallback class). */
	.error-msg {
		display: none;
	}

	.field.is-invalid .error-msg {
		display: block;
	}

	.session-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	@media (min-width: 768px) {
		.session-panel {
			display: none;
		}
	}

	@media (forced-colors: active) {
		.settings-subnav a[aria-current='page'],
		.settings-subnav a[aria-current='page']:hover {
			border-block-end-color: Highlight;
			color: Highlight;
		}

		.switch-input {
			background: Canvas;
			border-color: ButtonText;
		}

		.switch-input::after {
			background: ButtonText;
			box-shadow: none;
		}

		.switch-input:checked {
			background: Highlight;
			border-color: Highlight;
		}

		.switch-input:checked::after {
			background: HighlightText;
		}
	}
</style>
