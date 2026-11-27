<script lang="ts">
	import { cssText, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { flushSync, untrack } from 'svelte';
	import { applyAction, enhance } from '$app/forms';
	import type { AdminSectionItem } from '#lib/server/admin/service.ts';
	import Dialog from '#lib/components/platform/Dialog.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let busy = $state(false);

	let createName = $state('');
	let createSlug = $state('');
	let createSlugManuallyEdited = $state(false);

	let renderSections = $state<AdminSectionItem[]>(untrack(() => [...data.sections]));
	let visualOrderIds = $state<string[]>(untrack(() => data.sections.map((item) => item.id)));
	let lastSyncedDataRef = untrack(() => data.sections);

	const orderedSections = $derived.by(() => {
		const byId = new Map(renderSections.map((item) => [item.id, item]));
		const seen = new Set<string>();
		const result: AdminSectionItem[] = [];
		for (const id of visualOrderIds) {
			const found = byId.get(id);
			if (found) {
				result.push(found);
				seen.add(id);
			}
		}
		for (const item of renderSections) {
			if (!seen.has(item.id)) {
				result.push(item);
			}
		}
		return result;
	});

	let tableEl = $state<HTMLTableElement | null>(null);
	let tbodyEl = $state<HTMLTableSectionElement | null>(null);
	let reorderAnnouncement = $state('');
	let announceToggle = false;

	let editDialogOpen = $state(false);
	let editTarget = $state<AdminSectionItem | null>(null);
	let editName = $state('');
	let editSlug = $state('');
	let editDescription = $state('');
	let editOpener = $state<HTMLElement | null>(null);
	const editDirty = $derived(
		editTarget !== null &&
			(editName !== editTarget.name ||
				editSlug !== editTarget.slug ||
				editDescription !== (editTarget.description ?? ''))
	);

	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<AdminSectionItem | null>(null);
	let deleteOpener = $state<HTMLElement | null>(null);
	let moveTargetSectionId = $state('');

	$effect(() => {
		if (data.sections !== lastSyncedDataRef) {
			lastSyncedDataRef = data.sections;
			renderSections = [...data.sections];
			visualOrderIds = data.sections.map((item) => item.id);
			if (deleteTarget) {
				const refreshed = data.sections.find((item) => item.id === deleteTarget?.id) ?? null;
				deleteTarget = refreshed;
			}
		}
	});

	function slugifyPreview(input: string): string {
		const transliterated = input
			.trim()
			.replace(/Ç/g, 'c')
			.replace(/ç/g, 'c')
			.replace(/Ğ/g, 'g')
			.replace(/ğ/g, 'g')
			.replace(/İ/g, 'i')
			.replace(/I/g, 'i')
			.replace(/ı/g, 'i')
			.replace(/Ö/g, 'o')
			.replace(/ö/g, 'o')
			.replace(/Ş/g, 's')
			.replace(/ş/g, 's')
			.replace(/Ü/g, 'u')
			.replace(/ü/g, 'u')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();

		return transliterated
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.replace(/-{2,}/g, '-')
			.slice(0, 64)
			.replace(/-+$/g, '');
	}

	function handleCreateNameInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		createName = input.value;
		if (!createSlugManuallyEdited) {
			createSlug = slugifyPreview(createName);
		}
	}

	function handleCreateSlugInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		createSlugManuallyEdited = input.value.trim().length > 0;
		createSlug = input.value;
	}

	function runTableReorderTransition(
		nextIds: string[],
		focusElement: HTMLElement | null,
		announcementText: string
	) {
		const tableNode = tableEl;
		const tbodyNode = tbodyEl;

		const applyDomOrderAndState = () => {
			if (tbodyNode) {
				const domRows: HTMLTableRowElement[] = [];
				const rowById = new Map<string, HTMLTableRowElement>();
				for (const child of Array.from(tbodyNode.children)) {
					if (child instanceof HTMLTableRowElement && child.dataset.sectionId) {
						domRows.push(child);
						rowById.set(child.dataset.sectionId, child);
					}
				}
				const endAnchor = domRows.length > 0 ? domRows[domRows.length - 1].nextSibling : null;
				const supportsMoveBefore = Object.hasOwn(Element.prototype, 'moveBefore');
				for (const id of nextIds) {
					const row = rowById.get(id);
					if (!row) {
						continue;
					}
					if (supportsMoveBefore) {
						(
							tbodyNode as unknown as { moveBefore(node: Node, child: Node | null): void }
						).moveBefore(row, endAnchor);
					} else {
						tbodyNode.insertBefore(row, endAnchor);
					}
				}
			}

			flushSync(() => {
				visualOrderIds = nextIds;
			});

			if (focusElement && focusElement.isConnected && document.activeElement !== focusElement) {
				focusElement.focus({ preventScroll: true });
			}
		};

		const reducedMotion =
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (reducedMotion || !tableNode) {
			applyDomOrderAndState();
		} else {
			const scopedTransition = (
				tableNode as Element & {
					startViewTransition?: (cb: () => void) => { finished?: Promise<void> };
				}
			).startViewTransition;

			if (typeof scopedTransition === 'function') {
				scopedTransition.call(tableNode, applyDomOrderAndState);
			} else if (typeof document.startViewTransition === 'function') {
				document.startViewTransition(applyDomOrderAndState);
			} else {
				applyDomOrderAndState();
			}
		}

		announceToggle = !announceToggle;
		reorderAnnouncement = announceToggle ? announcementText : `${announcementText}\u00A0`;
	}

	function openEditDialog(section: AdminSectionItem, event: MouseEvent) {
		editOpener = event.currentTarget as HTMLElement;
		editTarget = section;
		editName = section.name;
		editSlug = section.slug;
		editDescription = section.description ?? '';
		editDialogOpen = true;
	}

	function restoreEditFocus() {
		editTarget = null;
		const opener = editOpener;
		editOpener = null;
		if (opener && opener.isConnected) {
			opener.focus();
		}
	}

	function openDeleteDialog(section: AdminSectionItem, event: MouseEvent) {
		deleteOpener = event.currentTarget as HTMLElement;
		deleteTarget = section;
		const firstAlternative = orderedSections.find((item) => item.id !== section.id);
		moveTargetSectionId = firstAlternative?.id ?? '';
		deleteDialogOpen = true;
	}

	function restoreDeleteFocus() {
		deleteTarget = null;
		const opener = deleteOpener;
		deleteOpener = null;
		if (opener && opener.isConnected) {
			opener.focus();
		}
	}

	const alternativeSections = $derived(
		orderedSections.filter((section) => section.id !== deleteTarget?.id)
	);
</script>

<svelte:head>
	<title>{pageTitle(t('sectionsAdmin.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('sectionsAdmin.title')}</h1>
		<p class="page-lead">
			{t('sectionsAdmin.lead')}
		</p>
	</header>

	<div class="visually-hidden" role="status" aria-live="polite">
		{reorderAnnouncement}
	</div>

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

	<section class="panel" aria-labelledby="create-section-heading">
		<h2 id="create-section-heading">{t('sectionsAdmin.create')}</h2>

		<form
			method="POST"
			action="?/create"
			class="section-form"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					await update({ reset: result.type === 'success' });
					if (result.type === 'success') {
						createName = '';
						createSlug = '';
						createSlugManuallyEdited = false;
					}
					busy = false;
				};
			}}
		>
			<div class="form-grid">
				<div class="field">
					<label for="create-section-name">{t('sectionsAdmin.name')}</label>
					<input
						id="create-section-name"
						name="name"
						type="text"
						required
						maxlength="80"
						value={createName}
						oninput={handleCreateNameInput}
						placeholder={t('sectionsAdmin.namePlaceholder')}
					/>
				</div>

				<div class="field">
					<label for="create-section-slug">{t('sectionsAdmin.slug')}</label>
					<input
						id="create-section-slug"
						name="slug"
						type="text"
						maxlength="64"
						autocorrect="off"
						autocapitalize="none"
						spellcheck={false}
						value={createSlug}
						oninput={handleCreateSlugInput}
						placeholder={t('sectionsAdmin.slugPlaceholder')}
					/>
				</div>
			</div>

			<div class="field">
				<label for="create-section-description">{t('sectionsAdmin.descriptionOptional')}</label>
				<input
					id="create-section-description"
					name="description"
					type="text"
					maxlength="280"
					placeholder={t('sectionsAdmin.descriptionPlaceholder')}
				/>
			</div>

			<div class="form-actions">
				<button type="submit" class="btn btn-primary" disabled={busy}>
					{busy ? t('sectionsAdmin.adding') : t('sectionsAdmin.add')}
				</button>
			</div>
		</form>
	</section>

	<section class="table-card" aria-labelledby="sections-table-heading">
		<div class="table-toolbar">
			<h2 id="sections-table-heading">
				{t('sectionsAdmin.tableTitle', { count: orderedSections.length })}
			</h2>
		</div>

		{#if orderedSections.length === 0}
			<div class="empty-wrap">
				<p class="empty-state">{t('share.noSections')}</p>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				tabindex="0"
				role="region"
				aria-labelledby="sections-table-heading"
				class="table-wrapper"
			>
				<table
					class="responsive-sections-table"
					style:--label-2={cssText(t('table.slug'))}
					style:--label-3={cssText(t('table.shares'))}
					style:--label-4={cssText(t('table.order'))}
					style:--label-5={cssText(t('table.actions'))}
					bind:this={tableEl}
				>
					<caption class="visually-hidden">{t('sectionsAdmin.caption')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('sectionsAdmin.colSection')}</th>
							<th scope="col">{t('table.slug')}</th>
							<th scope="col" class="num-col">{t('table.shares')}</th>
							<th scope="col">{t('table.order')}</th>
							<th scope="col" class="actions-col">{t('table.actions')}</th>
						</tr>
					</thead>
					<tbody bind:this={tbodyEl}>
						{#each renderSections as section (section.id)}
							{@const visualIndex = visualOrderIds.indexOf(section.id)}
							{@const atTop = visualIndex <= 0}
							{@const atBottom = visualIndex === -1 || visualIndex >= visualOrderIds.length - 1}
							<tr
								class="sortable-row"
								data-section-id={section.id}
								style:view-transition-name={`section-row-${section.id}`}
							>
								<th scope="row" class="section-name-cell">
									<div class="section-name-stack">
										<span class="section-title">{section.name}</span>
										{#if section.description}
											<span class="section-desc">{section.description}</span>
										{/if}
									</div>
								</th>
								<td>
									<code class="slug-code">/{section.slug}</code>
								</td>
								<td class="num-col shares-cell">
									<span class="share-count-value">{section.totalShareCount}</span>
									{#if section.exclusiveSilentShareCount > 0}
										<span class="silent-badge">
											{t('sectionsAdmin.silentOnly', { count: section.exclusiveSilentShareCount })}
										</span>
									{/if}
								</td>
								<td>
									<div class="sort-controls">
										<form
											method="POST"
											action="?/move"
											use:enhance={({ cancel, submitter }) => {
												if (atTop) {
													cancel();
													return;
												}
												busy = true;
												const triggerEl = submitter ?? null;
												return async ({ result }) => {
													if (result.type === 'success') {
														const payload = result.data as
															{ orderedSectionIds?: string[] } | undefined;
														const nextIds = payload?.orderedSectionIds ?? [...visualOrderIds];

														runTableReorderTransition(
															nextIds,
															triggerEl,
															t('sectionsAdmin.movedUp', { name: section.name })
														);
														await applyAction(result);
													} else {
														await applyAction(result);
													}
													busy = false;
												};
											}}
										>
											<input type="hidden" name="sectionId" value={section.id} />
											<input type="hidden" name="direction" value="up" />
											<button
												type="submit"
												class="btn btn-subtle btn-sm"
												aria-disabled={atTop ? 'true' : undefined}
												onclick={(e) => {
													if (atTop) {
														e.preventDefault();
													}
												}}
											>
												{t('sectionsAdmin.up')}
												<span class="visually-hidden">
													{t('sectionsAdmin.moveSr', { name: section.name })}
												</span>
											</button>
										</form>

										<form
											method="POST"
											action="?/move"
											use:enhance={({ cancel, submitter }) => {
												if (atBottom) {
													cancel();
													return;
												}
												busy = true;
												const triggerEl = submitter ?? null;
												return async ({ result }) => {
													if (result.type === 'success') {
														const payload = result.data as
															{ orderedSectionIds?: string[] } | undefined;
														const nextIds = payload?.orderedSectionIds ?? [...visualOrderIds];

														runTableReorderTransition(
															nextIds,
															triggerEl,
															t('sectionsAdmin.movedDown', { name: section.name })
														);
														await applyAction(result);
													} else {
														await applyAction(result);
													}
													busy = false;
												};
											}}
										>
											<input type="hidden" name="sectionId" value={section.id} />
											<input type="hidden" name="direction" value="down" />
											<button
												type="submit"
												class="btn btn-subtle btn-sm"
												aria-disabled={atBottom ? 'true' : undefined}
												onclick={(e) => {
													if (atBottom) {
														e.preventDefault();
													}
												}}
											>
												{t('sectionsAdmin.down')}
												<span class="visually-hidden">
													{t('sectionsAdmin.moveSr', { name: section.name })}
												</span>
											</button>
										</form>
									</div>
								</td>
								<td>
									<div class="row-actions">
										<button
											type="button"
											class="btn btn-ghost btn-sm"
											onclick={(event) => openEditDialog(section, event)}
										>
											{t('common.edit')} <span class="visually-hidden">({section.name})</span>
										</button>

										<button
											type="button"
											class="btn btn-danger-soft btn-sm"
											onclick={(event) => openDeleteDialog(section, event)}
										>
											{t('common.delete')} <span class="visually-hidden">({section.name})</span>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<Dialog
	bind:open={editDialogOpen}
	titleId="edit-section-dialog-title"
	closedby="closerequest"
	dirty={editDirty}
	guardUnsaved={true}
	onClose={restoreEditFocus}
>
	{#snippet children({ closeNow, requestClose })}
		<div class="dialog-panel">
			<div class="dialog-header">
				<h2 id="edit-section-dialog-title">{t('sectionsAdmin.editTitle')}</h2>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => requestClose()}
					aria-label={t('common.close')}
				>
					{t('common.close')}
				</button>
			</div>

			<form
				method="POST"
				action="?/update"
				class="dialog-form"
				use:enhance={() => {
					busy = true;
					return async ({ result, update }) => {
						await update();
						busy = false;
						if (result.type === 'success') {
							closeNow();
						}
					};
				}}
			>
				<input type="hidden" name="sectionId" value={editTarget?.id ?? ''} />

				<div class="field">
					<label for="edit-section-name">{t('sectionsAdmin.name')}</label>
					<input
						id="edit-section-name"
						name="name"
						type="text"
						required
						maxlength="80"
						bind:value={editName}
					/>
				</div>

				<div class="field">
					<label for="edit-section-slug">{t('sectionsAdmin.slug')}</label>
					<input
						id="edit-section-slug"
						name="slug"
						type="text"
						required
						maxlength="64"
						autocorrect="off"
						autocapitalize="none"
						spellcheck={false}
						bind:value={editSlug}
					/>
				</div>

				<div class="field">
					<label for="edit-section-description">{t('sectionsAdmin.description')}</label>
					<input
						id="edit-section-description"
						name="description"
						type="text"
						maxlength="280"
						bind:value={editDescription}
					/>
				</div>

				<div class="dialog-footer">
					<button type="button" class="btn btn-outline" onclick={() => requestClose()}>
						{t('common.cancel')}
					</button>
					<button type="submit" class="btn btn-primary" disabled={busy || !editTarget}>
						{busy ? t('common.saving') : t('share.saveChanges')}
					</button>
				</div>
			</form>
		</div>
	{/snippet}
</Dialog>

<Dialog
	bind:open={deleteDialogOpen}
	titleId="delete-section-dialog-title"
	closedby="closerequest"
	onClose={restoreDeleteFocus}
>
	{#snippet children({ closeNow })}
		<div class="dialog-panel">
			<div class="dialog-header">
				<h2 id="delete-section-dialog-title">{t('sectionsAdmin.deleteTitle')}</h2>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => closeNow()}
					aria-label={t('common.close')}
				>
					{t('common.close')}
				</button>
			</div>

			{#if (deleteTarget?.exclusiveSilentShareCount ?? 0) > 0}
				<div class="conflict-box" role="alert">
					<p>
						{t('sectionsAdmin.exclusiveDialog', {
							name: deleteTarget?.name ?? '',
							count: deleteTarget?.exclusiveSilentShareCount ?? 0
						})}
					</p>

					{#if alternativeSections.length > 0}
						<form
							method="POST"
							action="?/resolveSilentShares"
							class="resolve-form"
							use:enhance={() => {
								busy = true;
								return async ({ update }) => {
									await update();
									busy = false;
								};
							}}
						>
							<input type="hidden" name="sourceSectionId" value={deleteTarget?.id ?? ''} />
							<input type="hidden" name="mode" value="move" />
							<div class="field">
								<label for="resolve-target-section">{t('sectionsAdmin.target')}</label>
								<select
									id="resolve-target-section"
									name="targetSectionId"
									bind:value={moveTargetSectionId}
								>
									{#each alternativeSections as alt (alt.id)}
										<option value={alt.id}>{alt.name}</option>
									{/each}
								</select>
							</div>
							<button type="submit" class="btn btn-outline" disabled={busy}>
								{t('sectionsAdmin.moveSilent')}
							</button>
						</form>
					{/if}

					<form
						method="POST"
						action="?/resolveSilentShares"
						class="resolve-form"
						use:enhance={() => {
							busy = true;
							return async ({ update }) => {
								await update();
								busy = false;
							};
						}}
					>
						<input type="hidden" name="sourceSectionId" value={deleteTarget?.id ?? ''} />
						<input type="hidden" name="mode" value="publish" />
						<button type="submit" class="btn btn-outline" disabled={busy}>
							{t('sectionsAdmin.publish')}
						</button>
					</form>
				</div>
			{:else}
				<p class="dialog-desc">
					{t('sectionsAdmin.deleteEffectNamed', {
						name: deleteTarget?.name ?? t('sectionsAdmin.selected')
					})}
				</p>
			{/if}

			<form
				method="POST"
				action="?/delete"
				use:enhance={() => {
					busy = true;
					return async ({ result, update }) => {
						await update();
						busy = false;
						if (result.type === 'success') {
							closeNow();
						}
					};
				}}
			>
				<input type="hidden" name="sectionId" value={deleteTarget?.id ?? ''} />
				<div class="dialog-footer">
					<!-- svelte-ignore a11y_autofocus -->
					<button type="button" class="btn btn-outline" autofocus onclick={() => closeNow()}>
						{t('common.cancel')}
					</button>
					<button
						type="submit"
						class="btn btn-danger"
						disabled={busy || !deleteTarget || (deleteTarget.exclusiveSilentShareCount ?? 0) > 0}
					>
						{busy ? t('common.deleting') : t('sectionsAdmin.deleteConfirm')}
					</button>
				</div>
			</form>
		</div>
	{/snippet}
</Dialog>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: 18px 20px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-sm);
	}

	.panel h2,
	.table-toolbar h2,
	.dialog-header h2 {
		margin: 0;
		font: var(--type-section);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}

	.section-form,
	.dialog-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}

	.form-actions {
		display: flex;
	}

	.table-card {
		overflow: hidden;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-sm);
	}

	.table-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-block-end: 1px solid var(--border);
	}

	.empty-wrap {
		padding: var(--space-4);
	}

	.table-wrapper {
		container-type: inline-size;
		overflow-x: auto;
		max-inline-size: 100%;
	}

	.table-wrapper:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
		box-shadow: none;
	}

	.responsive-sections-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-sections-table th,
	.responsive-sections-table td {
		padding: 11px var(--space-4);
		border-block-end: 1px solid var(--border);
		text-align: start;
		vertical-align: middle;
	}

	.responsive-sections-table tbody tr:last-child th,
	.responsive-sections-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-sections-table thead th {
		background: var(--muted);
		font: var(--type-micro);
		font-weight: 600;
		color: var(--muted-foreground);
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		white-space: nowrap;
		padding-block: 9px;
	}

	.responsive-sections-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-sections-table tbody tr:hover {
		background: var(--muted);
	}

	.section-name-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.section-title {
		font: var(--type-ui);
		font-weight: 600;
		color: var(--foreground);
	}

	.section-desc {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.slug-code {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.responsive-sections-table th.num-col,
	.responsive-sections-table td.num-col {
		text-align: end;
		font-variant-numeric: tabular-nums;
	}

	.responsive-sections-table th.actions-col {
		text-align: end;
	}

	.shares-cell {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.share-count-value {
		font-variant-numeric: tabular-nums;
	}

	.silent-badge {
		margin-inline-start: var(--space-2);
		font: var(--type-hint);
		font-style: italic;
		color: var(--muted-foreground);
	}

	.sort-controls {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: var(--space-1);
	}

	.row-actions {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.empty-state {
		margin: 0;
		padding: var(--space-5) var(--space-4);
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--muted);
		font: var(--type-ui);
		color: var(--muted-foreground);
	}

	@container (width < 640px) {
		.responsive-sections-table thead {
			display: none;
		}

		.responsive-sections-table tbody,
		.responsive-sections-table tr,
		.responsive-sections-table th,
		.responsive-sections-table td {
			display: block;
			width: 100%;
		}

		.responsive-sections-table tr {
			border-block-end: 2px solid var(--border);
			padding: var(--space-2) 0;
		}

		.responsive-sections-table tbody th,
		.responsive-sections-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-sections-table td {
			display: grid;
			grid-template-columns: 7.5rem 1fr;
			gap: var(--space-2);
			align-items: center;
		}

		.responsive-sections-table td.num-col {
			text-align: start;
			white-space: normal;
		}

		.responsive-sections-table td::before {
			font: var(--type-micro);
			color: var(--muted-foreground);
		}

		.responsive-sections-table td:nth-child(2)::before {
			content: var(--label-2);
		}

		.responsive-sections-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-sections-table td:nth-child(4)::before {
			content: var(--label-4);
		}

		.responsive-sections-table td:nth-child(5)::before {
			content: var(--label-5);
		}

		.sort-controls,
		.row-actions {
			justify-content: flex-start;
			flex-wrap: wrap;
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
		font: var(--type-body);
		color: var(--muted-foreground);
	}

	.conflict-box {
		padding: var(--space-4);
		border-radius: 8px;
		background: var(--warning-soft);
		border: 1px solid color-mix(in oklab, var(--warning) 40%, transparent);
		color: var(--warning);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.conflict-box p {
		margin: 0;
		font: var(--type-ui);
		line-height: 1.5;
	}

	.conflict-box :global(.field > label) {
		color: var(--warning);
	}

	.resolve-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2);
	}

	.resolve-form .field {
		flex: 1 1 12rem;
	}

	.dialog-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
</style>
