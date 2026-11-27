<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { t } from '#lib/i18n/index.ts';

	/** Profile photo upload and removal (docs/designs/izgah-ui-v5.md §10.2). */
	interface Props {
		user: { id: string; name: string; avatarAssetKey: string | null };
	}

	let { user }: Props = $props();

	const MAX_BYTES = 5 * 1024 * 1024;
	const ACCEPT = 'image/jpeg,image/png,image/webp';

	let avatarKey = $derived(user.avatarAssetKey);
	let busy = $state(false);
	let error = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadForm = $state<HTMLFormElement | null>(null);

	function onFileChosen() {
		const file = fileInput?.files?.[0];
		error = '';
		if (!file) {
			return;
		}
		if (file.size > MAX_BYTES) {
			error = t('settings.avatarTooLarge');
			fileInput!.value = '';
			return;
		}
		uploadForm?.requestSubmit();
	}

	const handleResult = () => {
		busy = true;
		error = '';
		return async ({
			result
		}: {
			result: { type: string; data?: Record<string, unknown>; status?: number };
		}) => {
			busy = false;
			if (fileInput) {
				fileInput.value = '';
			}
			if (result.type === 'success') {
				avatarKey = (result.data?.avatarAssetKey as string | null) ?? null;
				toasts.push(String(result.data?.message ?? ''), { tone: 'success' });
				await invalidateAll();
			} else if (result.type === 'failure') {
				error = String(result.data?.error ?? t('settings.avatarUnsupported'));
			} else if (result.type === 'error') {
				error = result.status === 413 ? t('settings.avatarTooLarge') : t('error.generic');
			}
		};
	};
</script>

<div class="avatar-form flex flex-wrap items-center gap-4">
	<MemberAvatar id={user.id} name={user.name} avatarAssetKey={avatarKey} class="size-16 text-xl" />
	<div class="grid gap-2">
		<div class="flex flex-wrap gap-2">
			<form
				method="POST"
				action="?/setAvatar"
				enctype="multipart/form-data"
				bind:this={uploadForm}
				use:enhance={handleResult}
			>
				<input
					id="avatar-file"
					class="sr-only"
					type="file"
					name="avatar"
					accept={ACCEPT}
					aria-describedby="avatar-hint{error ? ' avatar-error' : ''}"
					disabled={busy}
					bind:this={fileInput}
					onchange={onFileChosen}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => fileInput?.click()}
				>
					<Camera aria-hidden="true" />
					{busy
						? t('settings.avatarUploading')
						: avatarKey
							? t('settings.avatarChange')
							: t('settings.avatarUpload')}
				</Button>
			</form>
			{#if avatarKey}
				<form method="POST" action="?/removeAvatar" use:enhance={handleResult}>
					<Button type="submit" variant="ghost" size="sm" disabled={busy}>
						<Trash2 aria-hidden="true" />
						{t('settings.avatarRemove')}
					</Button>
				</form>
			{/if}
		</div>
		<p id="avatar-hint" class="text-[12.5px] text-muted-foreground">{t('settings.avatarHint')}</p>
		{#if error}
			<p id="avatar-error" class="text-[12.5px] text-destructive" role="alert">{error}</p>
		{/if}
	</div>
</div>
