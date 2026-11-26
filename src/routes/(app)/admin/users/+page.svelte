<script lang="ts">
	import { cssText, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { AdminUserItem } from '#lib/server/admin/service.ts';
	import Dialog from '#lib/components/legacy/Dialog.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let hydrated = $state(false);
	let busy = $state(false);

	type IssuedLinkPayload = {
		kind: 'invite' | 'password_reset';
		url: string;
		expiresAt: string;
		userId: string;
		userName: string;
		userEmail: string;
	};

	let issuedDialogOpen = $state(false);
	let activeIssuedLink = $state<IssuedLinkPayload | null>(null);
	let lastHandledLinkUrl = $state<string | null>(null);

	let disableDialogOpen = $state(false);
	let disableTarget = $state<AdminUserItem | null>(null);
	let disableOpener = $state<HTMLElement | null>(null);

	let copyAreaEl = $state<HTMLDivElement | null>(null);
	let copyBubbleVisible = $state(false);
	let copyBubbleText = $state('');
	let copyRepeatToggle = false;
	let copyHideTimer: number | null = null;

	const userStats = $derived.by(() => {
		let active = 0;
		let pending = 0;
		let openInvites = 0;
		let passive = 0;
		let admins = 0;
		let totalShares = 0;

		for (const user of data.users) {
			totalShares += user.shareCount;
			if (!user.isActive) {
				passive += 1;
				continue;
			}
			if (user.role === 'admin') {
				admins += 1;
			}
			if (!user.emailVerified && !user.hasPassword) {
				pending += 1;
				if (user.hasOpenInvite) {
					openInvites += 1;
				}
			} else {
				active += 1;
			}
		}

		return { active, pending, openInvites, passive, admins, totalShares };
	});

	onMount(() => {
		hydrated = true;
		return () => {
			if (copyHideTimer !== null) {
				window.clearTimeout(copyHideTimer);
			}
		};
	});

	$effect(() => {
		if (!hydrated) {
			return;
		}
		const issued = form?.issuedLink as IssuedLinkPayload | undefined;
		if (issued && issued.url && issued.url !== lastHandledLinkUrl) {
			lastHandledLinkUrl = issued.url;
			activeIssuedLink = issued;
			copyBubbleVisible = false;
			copyBubbleText = '';
			issuedDialogOpen = true;
		}
	});

	async function performCopyFromSource(sourceId: string) {
		const sourceEl = document.getElementById(sourceId);
		const text =
			sourceEl instanceof HTMLInputElement || sourceEl instanceof HTMLTextAreaElement
				? sourceEl.value
				: (sourceEl?.textContent?.trim() ?? '');
		if (!text) {
			return;
		}

		let copied = false;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				copied = true;
			}
		} catch {
			copied = false;
		}

		copyRepeatToggle = !copyRepeatToggle;
		const baseText = copied ? t('error.copied') : t('error.copyManually');
		copyBubbleText = copyRepeatToggle ? baseText : `${baseText}\u00A0`;
		copyBubbleVisible = true;

		if (copyHideTimer !== null) {
			window.clearTimeout(copyHideTimer);
		}
		copyHideTimer = window.setTimeout(() => {
			copyBubbleVisible = false;
		}, 2200);
	}

	$effect(() => {
		const root = copyAreaEl;
		if (!root) {
			return;
		}
		const supportsCommandEvent = typeof window !== 'undefined' && 'CommandEvent' in window;

		if (supportsCommandEvent) {
			const handleCommand = (event: Event) => {
				const cmdEvent = event as Event & { command?: string };
				if (cmdEvent.command !== '--copy') {
					return;
				}
				const target = event.target as HTMLElement | null;
				const sourceId = target?.id ?? '';
				if (!sourceId) {
					return;
				}
				event.stopImmediatePropagation();
				void performCopyFromSource(sourceId);
			};
			root.addEventListener('command', handleCommand, true);
			return () => {
				root.removeEventListener('command', handleCommand, true);
			};
		}

		const handleFallbackClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const btn = target?.closest<HTMLButtonElement>('button[command="--copy"]');
			if (!btn) {
				return;
			}
			const sourceId = btn.getAttribute('commandfor') ?? '';
			if (sourceId) {
				void performCopyFromSource(sourceId);
			}
		};
		root.addEventListener('click', handleFallbackClick);
		return () => {
			root.removeEventListener('click', handleFallbackClick);
		};
	});

	const disableFallbackUser = $derived(
		data.disableUserId
			? (data.users.find((user) => user.id === data.disableUserId && !user.disabledAt) ?? null)
			: null
	);
	let handledDisableParam = false;
	$effect(() => {
		// A `?disable=<id>` URL opened with JS shows the regular confirmation dialog.
		if (hydrated && !handledDisableParam && disableFallbackUser) {
			handledDisableParam = true;
			disableTarget = disableFallbackUser;
			disableDialogOpen = true;
		}
	});

	function openDisableDialog(user: AdminUserItem, event: MouseEvent) {
		disableOpener = event.currentTarget as HTMLElement;
		disableTarget = user;
		disableDialogOpen = true;
	}

	function restoreDisableFocus() {
		disableTarget = null;
		const opener = disableOpener;
		disableOpener = null;
		if (opener && opener.isConnected) {
			opener.focus();
		}
	}

	function formatDate(iso: string | null): string {
		if (!iso) {
			return '—';
		}
		return formatWhen(iso);
	}

	function getUserStatusLabel(user: AdminUserItem): string {
		if (!user.isActive) {
			return t('users.statusPassive');
		}
		if (!user.emailVerified && !user.hasPassword) {
			return user.hasOpenInvite ? t('users.statusInvitePending') : t('users.statusInviteExpired');
		}
		return t('users.statusActive');
	}

	const inviteValues = $derived.by(() => {
		if (form?.actionType === 'invite' && form.values) {
			return form.values as { name?: string; email?: string; role?: string };
		}
		return {};
	});
</script>

<svelte:head>
	<title>{pageTitle(t('users.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('users.title')}</h1>
		<p class="page-lead">
			{t('users.lead')}
		</p>
	</header>

	<section class="kpi-strip" aria-label={t('users.summary')}>
		<div class="kpi-box">
			<span class="kpi-label">{t('users.kpiActive')}</span>
			<div class="kpi-value-row">
				<span class="kpi-value">{userStats.active}</span>
				<span class="kpi-sub">
					{t('users.kpiAdmins', { count: userStats.admins })}{#if userStats.passive > 0}
						{' '}{t('users.kpiPassive', { count: userStats.passive })}{/if}
				</span>
			</div>
		</div>
		<div class="kpi-box">
			<span class="kpi-label">{t('users.kpiPending')}</span>
			<div class="kpi-value-row">
				<span class="kpi-value">{userStats.pending}</span>
				<span class="kpi-sub">
					{userStats.openInvites > 0
						? t('users.kpiValid', { count: userStats.openInvites })
						: t('users.kpiNoInvites')}
				</span>
			</div>
		</div>
		<div class="kpi-box">
			<span class="kpi-label">{t('users.kpiShares')}</span>
			<div class="kpi-value-row">
				<span class="kpi-value">{userStats.totalShares}</span>
				<span class="kpi-sub">{t('users.kpiAccounts', { count: data.users.length })}</span>
			</div>
		</div>
	</section>

	{#if form?.success && form?.message}
		<div class="banner banner-success" role="status">
			<span>{form.message}</span>
		</div>
	{/if}

	{#if form?.error}
		<div class="banner banner-error" role="alert">
			<span>{form.error}</span>
		</div>
	{/if}

	{#if !hydrated && form?.issuedLink}
		<section class="panel issued-inline-panel" aria-labelledby="inline-link-heading">
			<h2 id="inline-link-heading">
				{form.issuedLink.kind === 'invite' ? t('users.inviteLinkTitle') : t('users.resetLinkTitle')}
			</h2>
			<p class="panel-desc">
				{t('users.issuedFor', { name: form.issuedLink.userName, email: form.issuedLink.userEmail })}
				<time class="mono-inline" datetime={form.issuedLink.expiresAt}>
					{formatDate(form.issuedLink.expiresAt)}
				</time>.
			</p>
			<div class="field">
				<label for="inline-issued-link-input">{t('users.link')}</label>
				<input
					id="inline-issued-link-input"
					type="url"
					readonly
					value={form.issuedLink.url}
					class="readonly-url-input"
				/>
			</div>
		</section>
	{/if}

	{#if !hydrated && disableFallbackUser}
		<section class="panel" aria-labelledby="disable-fallback-heading">
			<h2 id="disable-fallback-heading">{t('users.disableTitle')}</h2>
			<p class="panel-desc">
				{t('users.disableFallback', {
					name: disableFallbackUser.name,
					email: disableFallbackUser.email
				})}
			</p>
			<form method="POST" action="?/disable" class="fallback-actions">
				<input type="hidden" name="userId" value={disableFallbackUser.id} />
				<a href="/admin/users" class="btn btn-outline">{t('common.cancel')}</a>
				<button type="submit" class="btn btn-danger">{t('users.disableConfirm')}</button>
			</form>
		</section>
	{/if}

	<section class="panel" aria-labelledby="invite-heading">
		<div class="panel-head">
			<h2 id="invite-heading">{t('users.inviteTitle')}</h2>
			<p class="panel-desc">
				{t('users.inviteLead')}
			</p>
		</div>

		<form
			method="POST"
			action="?/invite"
			class="invite-form"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					await update({ reset: result.type === 'success' });
					busy = false;
				};
			}}
		>
			<div class="form-grid">
				<div class="field">
					<label for="invite-name">{t('invite.name')}</label>
					<input
						id="invite-name"
						name="name"
						type="text"
						required
						minlength="2"
						maxlength="120"
						value={inviteValues.name ?? ''}
						placeholder={t('users.namePlaceholder')}
					/>
				</div>

				<div class="field">
					<label for="invite-email">{t('settings.email')}</label>
					<input
						id="invite-email"
						name="email"
						type="email"
						required
						autocorrect="off"
						autocapitalize="none"
						spellcheck={false}
						value={inviteValues.email ?? ''}
						placeholder={t('users.emailPlaceholder')}
					/>
				</div>
			</div>

			<fieldset class="role-fieldset">
				<legend>{t('settings.role')}</legend>
				<div class="radio-group">
					<label class="radio-option" for="invite-role-member">
						<input
							id="invite-role-member"
							type="radio"
							name="role"
							value="member"
							checked={inviteValues.role !== 'admin'}
						/>
						<span>{t('role.member')}</span>
					</label>
					<label class="radio-option" for="invite-role-admin">
						<input
							id="invite-role-admin"
							type="radio"
							name="role"
							value="admin"
							checked={inviteValues.role === 'admin'}
						/>
						<span>{t('role.admin')}</span>
					</label>
				</div>
			</fieldset>

			<div class="form-actions">
				<button type="submit" class="btn btn-primary" disabled={busy}>
					{busy ? t('users.creating') : t('users.createInvite')}
				</button>
			</div>
		</form>
	</section>

	<section class="table-card" aria-labelledby="users-table-heading">
		<div class="table-toolbar">
			<h2 id="users-table-heading">{t('users.tableTitle', { count: data.users.length })}</h2>
			<span class="table-summary">
				{t('users.tableSummary', {
					active: userStats.active,
					pending: userStats.pending,
					passive: userStats.passive
				})}
			</span>
		</div>

		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div tabindex="0" role="region" aria-labelledby="users-table-heading" class="table-wrapper">
			<table
				class="responsive-users-table"
				style:--label-2={cssText(t('table.status'))}
				style:--label-3={cssText(t('table.share'))}
				style:--label-4={cssText(t('table.role'))}
				style:--label-5={cssText(t('table.joined'))}
				style:--label-6={cssText(t('table.actions'))}
			>
				<caption class="visually-hidden">{t('users.tableCaption')}</caption>
				<thead>
					<tr>
						<th scope="col">{t('users.colMember')}</th>
						<th scope="col">{t('table.status')}</th>
						<th scope="col" class="num-col">{t('table.share')}</th>
						<th scope="col">{t('table.role')}</th>
						<th scope="col">{t('table.joined')}</th>
						<th scope="col" class="actions-col">{t('table.actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as user (user.id)}
						<tr class:is-disabled={!user.isActive}>
							<th scope="row" class="user-cell">
								<div class="member-cell">
									<div class="member-meta">
										<span class="user-name">{user.name}</span>
										<span class="user-email">{user.email}</span>
									</div>
								</div>
							</th>
							<td>
								<span
									class="status-pill"
									class:status-active={user.isActive && (user.emailVerified || user.hasPassword)}
									class:status-pending={user.isActive && !user.emailVerified && !user.hasPassword}
									class:status-passive={!user.isActive}
								>
									<span class="status-dot" aria-hidden="true"></span>
									<span>{getUserStatusLabel(user)}</span>
								</span>
							</td>
							<td class="num-col">{user.shareCount}</td>
							<td class="role-cell">
								{#if user.isActive}
									<form
										method="POST"
										action="?/changeRole"
										class="inline-role-form"
										use:enhance={() => {
											busy = true;
											return async ({ update }) => {
												await update();
												busy = false;
											};
										}}
									>
										<input type="hidden" name="userId" value={user.id} />
										<label for="role-{user.id}" class="visually-hidden">
											{t('users.roleFor', { name: user.name })}
										</label>
										<select id="role-{user.id}" name="role" value={user.role} class="role-select">
											<option value="member">{t('role.member')}</option>
											<option value="admin">{t('role.admin')}</option>
										</select>
										<button type="submit" class="btn btn-subtle btn-sm" disabled={busy}>
											{t('users.saveRole')} <span class="visually-hidden">({user.name})</span>
										</button>
									</form>
								{:else}
									<span class="passive-role">
										{user.role === 'admin' ? t('role.admin') : t('role.member')}
									</span>
								{/if}
							</td>
							<td class="date-cell">
								<time datetime={user.createdAt}>{formatDate(user.createdAt)}</time>
							</td>
							<td class="actions-cell">
								{#if user.isActive}
									<div class="row-actions">
										{#if !user.emailVerified && !user.hasPassword}
											<form
												method="POST"
												action="?/regenerateInvite"
												use:enhance={() => {
													busy = true;
													return async ({ update }) => {
														await update();
														busy = false;
													};
												}}
											>
												<input type="hidden" name="userId" value={user.id} />
												<button type="submit" class="btn btn-ghost btn-sm" disabled={busy}>
													{t('users.renewInvite')}
													<span class="visually-hidden">({user.name})</span>
												</button>
											</form>
										{:else}
											<form
												method="POST"
												action="?/resetPassword"
												use:enhance={() => {
													busy = true;
													return async ({ update }) => {
														await update();
														busy = false;
													};
												}}
											>
												<input type="hidden" name="userId" value={user.id} />
												<button type="submit" class="btn btn-ghost btn-sm" disabled={busy}>
													{t('users.resetPassword')}
													<span class="visually-hidden">({user.name})</span>
												</button>
											</form>
										{/if}

										{#if hydrated}
											<button
												type="button"
												class="btn btn-danger-soft btn-sm"
												disabled={busy}
												onclick={(event) => openDisableDialog(user, event)}
											>
												{t('users.disable')} <span class="visually-hidden">({user.name})</span>
											</button>
										{:else}
											<a
												href="?disable={encodeURIComponent(user.id)}"
												class="btn btn-danger-soft btn-sm"
											>
												{t('users.disable')} <span class="visually-hidden">({user.name})</span>
											</a>
										{/if}
									</div>
								{:else}
									<div class="row-actions">
										<span class="disabled-meta">
											{t('users.disabledAt', { date: formatDate(user.disabledAt) })}
										</span>
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>

<Dialog bind:open={issuedDialogOpen} titleId="issued-link-dialog-title" closedby="any">
	{#snippet children({ closeNow })}
		<div class="dialog-panel" bind:this={copyAreaEl}>
			<div class="dialog-header">
				<h2 id="issued-link-dialog-title">
					{activeIssuedLink?.kind === 'invite'
						? t('users.inviteLinkTitle')
						: t('users.resetLinkTitle')}
				</h2>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => closeNow()}
					aria-label={t('common.close')}
				>
					{t('common.close')}
				</button>
			</div>

			<p class="dialog-desc">
				{t('users.linkShownOnce', {
					name: activeIssuedLink?.userName ?? '',
					email: activeIssuedLink?.userEmail ?? ''
				})}
			</p>

			<div class="copy-field-group">
				<label for="issued-link-value">{t('users.link')}</label>
				<div class="copy-row">
					<input
						id="issued-link-value"
						type="url"
						readonly
						value={activeIssuedLink?.url ?? ''}
						class="readonly-url-input"
					/>
					<div class="copy-btn-wrapper">
						<button
							type="button"
							class="btn btn-primary"
							command="--copy"
							commandfor="issued-link-value"
						>
							{t('users.copyLink')}
						</button>
						<span
							class="copy-bubble"
							class:is-visible={copyBubbleVisible}
							role="status"
							aria-live="polite"
						>
							{copyBubbleText}
						</span>
					</div>
				</div>
				{#if activeIssuedLink?.expiresAt}
					<p class="hint">
						{t('users.validUntil')}
						<time class="mono-inline" datetime={activeIssuedLink.expiresAt}>
							{formatDate(activeIssuedLink.expiresAt)}
						</time>
					</p>
				{/if}
			</div>

			<div class="dialog-footer">
				<button type="button" class="btn btn-outline" onclick={() => closeNow()}>
					{t('common.close')}
				</button>
			</div>
		</div>
	{/snippet}
</Dialog>

<Dialog
	bind:open={disableDialogOpen}
	titleId="disable-user-dialog-title"
	closedby="closerequest"
	onClose={restoreDisableFocus}
>
	{#snippet children({ closeNow })}
		<div class="dialog-panel">
			<div class="dialog-header">
				<h2 id="disable-user-dialog-title">{t('users.disableTitle')}</h2>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => closeNow()}
					aria-label={t('common.close')}
				>
					{t('common.close')}
				</button>
			</div>

			<p class="dialog-desc">
				{t('users.disableDialog', {
					name: disableTarget?.name ?? t('users.selectedMember'),
					email: disableTarget?.email ?? ''
				})}
			</p>

			<form
				method="POST"
				action="?/disable"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update();
						busy = false;
						closeNow();
					};
				}}
			>
				<input type="hidden" name="userId" value={disableTarget?.id ?? ''} />
				<div class="dialog-footer">
					<!-- svelte-ignore a11y_autofocus -->
					<button type="button" class="btn btn-outline" autofocus onclick={() => closeNow()}>
						{t('common.cancel')}
					</button>
					<button type="submit" class="btn btn-danger" disabled={busy || !disableTarget}>
						{busy ? t('users.disabling') : t('users.disableConfirm')}
					</button>
				</div>
			</form>
		</div>
	{/snippet}
</Dialog>

<style>
	.fallback-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.admin-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4) 0 0;
		background: none;
		border: 0;
		border-block-start: 1px solid var(--k-color-text);
		border-radius: 0;
	}

	.panel-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.panel h2,
	.table-toolbar h2,
	.dialog-header h2 {
		margin: 0;
		font: var(--k-text-section);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}

	.panel-desc {
		margin: 0;
		font: var(--k-text-hint);
		color: var(--k-color-text-muted);
	}

	.mono-inline {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
	}

	.invite-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}

	.copy-field-group label {
		font: var(--k-text-ui);
		font-weight: 600;
	}

	.readonly-url-input {
		inline-size: 100%;
		min-block-size: 38px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--k-color-line-strong);
		border-radius: var(--k-radius-sm);
		background: var(--k-color-surface-2);
		color: var(--k-color-text);
		flex: 1 1 16rem;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.role-fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.role-fieldset legend {
		font: var(--k-text-ui);
		font-weight: 600;
		padding: 0 var(--space-1);
		color: var(--k-color-text);
	}

	.radio-group {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.radio-option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 36px;
		font: var(--k-text-ui);
		cursor: pointer;
	}

	.radio-option input {
		inline-size: 1rem;
		block-size: 1rem;
	}

	.form-actions {
		display: flex;
		justify-content: flex-start;
	}

	.table-card {
		border-block-start: 1px solid var(--k-color-text);
		overflow: hidden;
	}

	.table-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-block-end: 1px solid var(--k-color-line);
	}

	.table-summary {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--k-color-text-muted);
	}

	.table-wrapper {
		position: relative;
		container-type: inline-size;
		overflow-x: auto;
		max-inline-size: 100%;
	}

	.table-wrapper:focus-visible {
		outline: 2px solid var(--k-color-accent);
		outline-offset: -2px;
		box-shadow: none;
	}

	.responsive-users-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-users-table th,
	.responsive-users-table td {
		padding: 11px var(--space-3);
		border-block-end: 1px solid var(--k-color-line);
		text-align: start;
		vertical-align: middle;
	}

	.responsive-users-table tbody tr:last-child th,
	.responsive-users-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-users-table thead th {
		background: var(--k-color-surface-2);
		font: var(--k-text-micro);
		font-weight: 600;
		color: var(--k-color-text-muted);
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		white-space: nowrap;
		padding-block: 9px;
	}

	.responsive-users-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-users-table tbody tr:hover {
		background: var(--k-color-surface-2);
	}

	.responsive-users-table tbody tr.is-disabled {
		background: var(--k-color-surface-2);
		color: var(--k-color-text-muted);
	}

	.user-cell {
		font: var(--k-text-ui);
		min-inline-size: 12rem;
	}

	.member-cell {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.member-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-inline-size: 0;
	}

	.user-name {
		font: var(--k-text-ui);
		font-weight: 600;
		color: var(--k-color-text);
	}

	.is-disabled .user-name {
		color: var(--k-color-text-muted);
	}

	.user-email {
		font: var(--k-text-meta);
		color: var(--k-color-text-muted);
		word-break: normal;
		white-space: nowrap;
	}

	.responsive-users-table th.num-col,
	.responsive-users-table td.num-col {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.responsive-users-table tbody td.num-col {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--k-color-text);
	}

	.responsive-users-table tbody tr.is-disabled td.num-col {
		color: var(--k-color-text-muted);
	}

	.responsive-users-table th.actions-col {
		text-align: end;
	}

	.date-cell {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--k-color-text-muted);
		white-space: nowrap;
	}

	.inline-role-form {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: var(--space-1);
	}

	.role-select {
		min-block-size: 30px;
		padding: 0 var(--space-5) 0 var(--space-2);
		font: var(--k-text-ui);
		font-size: 0.8125rem;
		color: var(--k-color-text);
		background: var(--k-color-surface-2);
		border: 1px solid var(--k-color-line-strong);
		border-radius: var(--k-radius-sm);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background-color var(--dur-fast) var(--ease);
	}

	.role-select:hover {
		border-color: var(--k-color-text-secondary);
	}

	.passive-role {
		font: var(--k-text-ui);
		color: var(--k-color-text-muted);
	}

	.row-actions {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.disabled-meta {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--k-color-text-muted);
		white-space: nowrap;
	}

	@media (pointer: coarse) {
		.role-select,
		.radio-option {
			min-block-size: 44px;
		}
	}

	@container (width < 640px) {
		.responsive-users-table thead {
			display: none;
		}

		.responsive-users-table tbody,
		.responsive-users-table tr,
		.responsive-users-table th,
		.responsive-users-table td {
			display: block;
			width: 100%;
		}

		.responsive-users-table tr {
			border-block-end: 2px solid var(--k-color-line);
			padding: var(--space-2) 0;
		}

		.responsive-users-table tbody th,
		.responsive-users-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-users-table td {
			display: grid;
			grid-template-columns: 7.5rem 1fr;
			gap: var(--space-2);
			align-items: center;
		}

		.responsive-users-table td.num-col {
			text-align: start;
		}

		.responsive-users-table td::before {
			font: var(--k-text-micro);
			color: var(--k-color-text-muted);
		}

		.responsive-users-table td:nth-child(2)::before {
			content: var(--label-2);
		}

		.responsive-users-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-users-table td:nth-child(4)::before {
			content: var(--label-4);
		}

		.responsive-users-table td:nth-child(5)::before {
			content: var(--label-5);
		}

		.responsive-users-table td:nth-child(6)::before {
			content: var(--label-6);
		}

		.inline-role-form,
		.row-actions {
			justify-content: flex-start;
			flex-wrap: wrap;
		}

		.user-cell {
			min-inline-size: 0;
		}

		.user-email {
			white-space: normal;
			overflow-wrap: anywhere;
		}
	}

	.dialog-panel {
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.dialog-desc {
		margin: 0;
		font: var(--k-text-body);
		color: var(--k-color-text-secondary);
	}

	.copy-field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.copy-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.copy-btn-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.copy-bubble {
		opacity: 0;
		transition: opacity var(--dur-base) var(--ease);
		font: var(--k-text-micro);
		color: var(--k-color-ok-text);
		background: var(--k-color-ok-soft);
		border: 1px solid var(--k-color-ok-border);
		border-radius: var(--k-radius-pill);
		padding: 2px 10px;
		pointer-events: none;
	}

	.copy-bubble.is-visible {
		opacity: 1;
	}

	.hint {
		margin: 0;
		font: var(--k-text-hint);
		color: var(--k-color-text-muted);
	}

	.dialog-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-block-start: var(--space-1);
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
</style>
