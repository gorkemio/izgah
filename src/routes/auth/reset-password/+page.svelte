<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import AuthLayout from '#lib/components/auth/AuthLayout.svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let formEl = $state<HTMLFormElement | null>(null);
	let showPassword = $state(false);
	let submitting = $state(false);
	let passwordInvalid = $state(false);
	let liveAnnouncement = $state('');
	let announcementToggle = false;

	const tokenGone = $derived(Boolean(form && 'tokenGone' in form && form.tokenGone));

	function isControlUserInvalid(
		control: HTMLInputElement,
		supportsUserInvalid: boolean,
		dirtyFields: WeakSet<HTMLInputElement>
	): boolean {
		if (control.readOnly) {
			return false;
		}
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
			if (control.name === 'password') {
				passwordInvalid = result.invalid;
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
	<title>{pageTitle(t('reset.title'))}</title>
</svelte:head>

<AuthLayout>
	<section class="auth-card" aria-labelledby="reset-heading">
		{#if tokenGone}
			<header class="auth-header">
				<h1 id="reset-heading">{t('reset.invalidHeading')}</h1>
			</header>
			<div class="banner banner-error" role="alert">
				<span>{form?.error ?? t('reset.invalid')}</span>
			</div>
			<p class="link-row">
				<a href="/login" class="btn btn-subtle">
					<span>{t('auth.backToSignIn')}</span>
				</a>
			</p>
		{:else}
			<header class="auth-header">
				<h1 id="reset-heading">{t('reset.heading')}</h1>
				<p class="subtitle">
					{t('reset.subtitle')}
				</p>
			</header>

			{#if form?.error}
				<div class="banner banner-error" role="alert">
					<span>{form.error}</span>
				</div>
			{/if}

			<form
				bind:this={formEl}
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<input type="hidden" name="token" value={data.token} />

				<div class="field">
					<label for="reset-email">{t('login.email')}</label>
					<input
						id="reset-email"
						type="email"
						autocomplete="username"
						value={data.email}
						readonly
						aria-readonly="true"
					/>
				</div>

				<div class="field" class:is-invalid={passwordInvalid}>
					<label for="password">{t('invite.newPassword')}</label>
					<p id="password-hint" class="hint">{t('reset.passwordHint')}</p>
					<div class="password-row">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="new-password"
							enterkeyhint="done"
							minlength="10"
							maxlength="128"
							required
							aria-invalid="false"
							aria-describedby="password-hint"
							data-hint="password-hint"
							data-error="password-error"
						/>
						<button
							type="button"
							class="toggle-btn"
							aria-pressed={showPassword}
							aria-controls="password"
							onclick={() => (showPassword = !showPassword)}
						>
							<span>{showPassword ? t('common.hide') : t('common.show')}</span>
						</button>
					</div>
					<p id="password-error" class="error-msg" data-message={t('auth.passwordLength')}>
						<span>{t('auth.passwordLength')}</span>
					</p>
				</div>

				<button type="submit" class="primary-btn" disabled={submitting}>
					{submitting ? t('reset.updating') : t('settings.updatePassword')}
				</button>

				<div class="visually-hidden" aria-live="polite">{liveAnnouncement}</div>
			</form>
		{/if}
	</section>
</AuthLayout>
