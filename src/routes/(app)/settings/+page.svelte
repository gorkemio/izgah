<script lang="ts">
	import { getLocale, LOCALE_NATIVE_NAMES, LOCALES, t } from '#lib/i18n/index.ts';
	import { instanceName, pageTitle, sourceUrl } from '#lib/instance.ts';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AvatarForm from '#lib/components/member/AvatarForm.svelte';
	import EffectsForm from '#lib/components/shell/EffectsForm.svelte';
	import PaletteForm from '#lib/components/shell/PaletteForm.svelte';
	import ThemeForm from '#lib/components/shell/ThemeForm.svelte';
	import { getShortcutPreference } from '#lib/client/shortcuts.svelte.ts';
	import type { ThemeChoice } from '#lib/client/theme.svelte.ts';
	import { DEFAULT_PALETTE, type EffectLevel, type Palette } from '#lib/types/appearance.ts';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const shortcutPreference = getShortcutPreference();
	const currentLocale = getLocale();
	// The layout loads the theme cookie for every app page.
	const themeChoice = $derived((page.data as { theme?: ThemeChoice }).theme ?? 'system');
	const effectLevel = $derived((page.data as { effects?: EffectLevel }).effects ?? 'full');
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

	// An instance named after the software would read "Izgah runs on Izgah" (izgah-ui-v4 §10).
	const runsOnItself = instanceName().replace(/^İ/, 'I').toLowerCase() === 'izgah';
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
					<span class="settings-row-title">{t('settings.avatarTitle')}</span>
				</dt>
				<dd class="settings-row-control">
					<AvatarForm user={data.user} />
				</dd>
			</div>
			<div class="settings-row">
				<dt class="settings-row-info">
					<span class="settings-row-title">{t('settings.name')}</span>
					<span class="field-hint">{t('settings.nameHint')}</span>
				</dt>
				<dd class="settings-row-control profile-identity">
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
					<span class="role-value">
						{data.user.role === 'admin' ? t('role.admin') : t('role.member')}
					</span>
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
					<ThemeForm theme={themeChoice} variant="list" legend={t('settings.modeLegend')} />
				</div>
			</div>

			<div class="settings-row">
				<div class="settings-row-info">
					<p class="settings-row-title">{t('settings.effects')}</p>
					<p class="field-hint">{t('settings.effectsHint')}</p>
				</div>
				<div class="settings-row-control">
					<EffectsForm effects={effectLevel} />
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
					<form
						method="POST"
						action="?/setLocale"
						class="locale-form grid justify-items-start gap-3"
					>
						<fieldset class="radio-list locale-options" aria-labelledby="language-heading">
							{#each LOCALES as code (code)}
								<label class="radio-option">
									<input
										type="radio"
										name="locale"
										value={code}
										lang={code}
										checked={currentLocale === code}
									/>
									<span lang={code}>{LOCALE_NATIVE_NAMES[code]}</span>
								</label>
							{/each}
						</fieldset>
						<!-- An explicit Apply: changing the radio alone must not reload the page, or arrowing
						     through the options would navigate away (WCAG 3.2.2). -->
						<button type="submit" class="btn btn-outline btn-sm">{t('common.apply')}</button>
					</form>
				</div>
			</div>

			{#if shortcutPreference}
				<div class="settings-row">
					<div class="settings-row-info">
						<label for="single-key-shortcuts" class="settings-row-title">
							{t('settings.shortcuts')}
						</label>
						<p id="single-key-shortcuts-hint" class="field-hint">
							{t('settings.shortcutsHint')}
						</p>
					</div>
					<div class="settings-row-control toggle-row">
						<input
							id="single-key-shortcuts"
							type="checkbox"
							class="switch-input"
							aria-describedby="single-key-shortcuts-hint"
							checked={shortcutPreference.enabled}
							onchange={(event) => shortcutPreference.set(event.currentTarget.checked)}
						/>
						<span class="toggle-status">
							{shortcutPreference.enabled ? t('settings.shortcutsOn') : t('settings.shortcutsOff')}
						</span>
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
							<span>{form.message}</span>
						</p>
					{/if}

					{#if form?.error}
						<p class="banner banner-error" role="alert">
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
							<span>{t('settings.adminPanel')}</span>
						</a>
					{/if}
					<form method="POST" action="/logout">
						<button type="submit" class="btn btn-danger-soft">
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
					<p class="settings-row-title">
						{runsOnItself
							? t('settings.softwareSelf')
							: t('settings.software', { name: instanceName() })}
					</p>
					<p class="field-hint">{t('settings.softwareHint')}</p>
				</div>
				<div class="settings-row-control">
					<a href={sourceUrl()} class="btn btn-subtle" rel="noopener noreferrer" target="_blank">
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
		font: var(--type-display);
		letter-spacing: -0.02em;
		color: var(--foreground);
	}

	.page-subtitle {
		font: var(--type-ui);
		font-weight: 400;
		color: var(--muted-foreground);
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

	/* Strict serif boundary: section h2 stays --font-sans (--type-section). */
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

	.settings-rows {
		display: grid;
		margin: 0;
		padding-inline: 20px;
	}

	.settings-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding-block: 18px;
		border-block-end: 1px solid var(--hairline);
		align-items: start;
	}

	.settings-row:last-child {
		border-block-end: 0;
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

	.settings-row-control {
		min-inline-size: 0;
	}

	.profile-identity {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.profile-value {
		font: var(--type-body);
		font-weight: 500;
		color: var(--foreground);
	}

	.profile-email {
		font: var(--type-meta);
		font-size: 0.84375rem;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}

	.palette-slot :global(.palette-form) {
		margin-block-start: 0;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.toggle-status {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	/* Shortcuts: a native checkbox, not a switch (izgah-ui-v4 §7). */
	.switch-input {
		inline-size: 16px;
		block-size: 16px;
		margin: 0;
		flex: none;
		cursor: pointer;
	}

	.radio-list {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.radio-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 32px;
		font: var(--type-ui);
		font-weight: 400;
		color: var(--foreground);
		cursor: pointer;
	}

	.radio-option:has(input:checked) {
		font-weight: 600;
	}

	.radio-option input {
		inline-size: 16px;
		block-size: 16px;
		margin: 0;
	}

	.role-value {
		font: var(--type-body);
		color: var(--foreground);
	}

	@media (pointer: coarse) {
		.radio-option {
			min-block-size: 44px;
		}
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
		border-color: var(--destructive);
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
	}
</style>
