<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName, pageTitle } from '#lib/instance.ts';
	import AuthLayout from '#lib/components/auth/AuthLayout.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let formEl = $state<HTMLFormElement | null>(null);
	let showPassword = $state(false);
	let submitting = $state(false);
	let emailInvalid = $state(false);
	let passwordInvalid = $state(false);
	let liveAnnouncement = $state('');
	let announcementToggle = false;

	const currentNext = $derived(form?.next ?? data.next);
	// Bound (not a one-way `value`) so an address typed before hydration is kept, not reset.
	let email = $derived(form?.email ?? '');

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
			if (control.name === 'email') {
				emailInvalid = result.invalid;
			} else if (control.name === 'password') {
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
	<title>{pageTitle(t('login.title'))}</title>
</svelte:head>

<AuthLayout>
	<section class="auth-card" aria-labelledby="login-heading">
		<header class="auth-header">
			<h1 id="login-heading">{t('login.heading', { name: instanceName() })}</h1>
			<p class="subtitle">{t('login.subtitle')}</p>
		</header>

		{#if data.resetSuccess}
			<p class="banner banner-success" role="status">
				<Icon name="check" size={16} />
				<span>{t('login.passwordUpdated')}</span>
			</p>
		{/if}

		{#if form?.error}
			<div class="banner banner-error" role="alert">
				<Icon name="alert" size={16} />
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
			<input type="hidden" name="next" value={currentNext} />

			<div class="field" class:is-invalid={emailInvalid}>
				<label for="email">{t('login.email')}</label>
				<p id="email-hint" class="hint">{t('login.emailHint')}</p>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="username"
					spellcheck="false"
					enterkeyhint="next"
					required
					aria-invalid="false"
					aria-describedby="email-hint"
					data-hint="email-hint"
					data-error="email-error"
					bind:value={email}
				/>
				<p id="email-error" class="error-msg" data-message={t('admin.emailInvalid')}>
					<Icon name="alert" size={16} />
					<span>{t('admin.emailInvalid')}</span>
				</p>
			</div>

			<div class="field" class:is-invalid={passwordInvalid}>
				<label for="password">{t('login.password')}</label>
				<p id="password-hint" class="hint">{t('login.passwordHint')}</p>
				<div class="password-row">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						autocomplete="current-password"
						enterkeyhint="done"
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
						<Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
						<span>{showPassword ? t('common.hide') : t('common.show')}</span>
					</button>
				</div>
				<p id="password-error" class="error-msg" data-message={t('login.passwordRequired')}>
					<Icon name="alert" size={16} />
					<span>{t('login.passwordRequired')}</span>
				</p>
			</div>

			<button type="submit" class="primary-btn" disabled={submitting}>
				{submitting ? t('login.signingIn') : t('login.title')}
			</button>

			<div class="visually-hidden" aria-live="polite">{liveAnnouncement}</div>
		</form>

		<p class="auth-foot-hint">
			{t('login.noAccount')}
		</p>
	</section>
</AuthLayout>
