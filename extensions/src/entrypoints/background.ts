import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { consumePendingShareContext, writePendingShareContext } from '../lib/storage';
import { PENDING_SHARE_TTL_MS, type PendingShareContext } from '../lib/types';
import { msg } from '../lib/i18n';

export const CONTEXT_MENU_SHARE_ID = 'share-to-izgah';

function isConsumePendingShareMessage(message: unknown): boolean {
	return (
		typeof message === 'object' &&
		message !== null &&
		'type' in message &&
		(message as { type?: unknown }).type === 'consumePendingShare'
	);
}

/**
 * Registers MV3 service worker / event page listeners synchronously at setup time.
 */
export function setupBackground(): void {
	let latestPendingShare: PendingShareContext | null = null;
	let inFlightPendingWrite: Promise<void> = Promise.resolve();

	browser.runtime.onInstalled.addListener(async () => {
		await browser.contextMenus.removeAll();
		browser.contextMenus.create({
			id: CONTEXT_MENU_SHARE_ID,
			title: msg('contextMenuShare'),
			contexts: ['page', 'link']
		});
	});

	browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
		if (!isConsumePendingShareMessage(message)) {
			return;
		}

		void (async () => {
			await inFlightPendingWrite;
			const inMemory = latestPendingShare;
			latestPendingShare = null;
			const stored = await consumePendingShareContext().catch(() => null);
			const candidate = inMemory ?? stored;

			if (!candidate || Date.now() - candidate.createdAt > PENDING_SHARE_TTL_MS) {
				sendResponse(null);
				return;
			}
			sendResponse(candidate);
		})();

		return true;
	});

	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId !== CONTEXT_MENU_SHARE_ID) {
			return;
		}

		const hasLinkUrl = typeof info.linkUrl === 'string' && info.linkUrl.trim() !== '';
		const context: PendingShareContext = hasLinkUrl
			? {
					url: info.linkUrl!.trim(),
					title: null,
					source: 'link',
					createdAt: Date.now()
				}
			: {
					url: tab?.url ?? info.pageUrl ?? '',
					title: tab?.title ?? null,
					source: 'page',
					createdAt: Date.now()
				};

		latestPendingShare = context;
		inFlightPendingWrite = writePendingShareContext(context).catch(() => {});

		const openStandaloneWindow = async () => {
			await inFlightPendingWrite;
			const popupUrl = `${browser.runtime.getURL('/popup.html')}?mode=standalone`;
			await browser.windows.create({
				url: popupUrl,
				type: 'popup',
				width: 420,
				height: 620
			});
		};

		try {
			if (typeof browser.action?.openPopup === 'function') {
				const openResult = browser.action.openPopup();
				void Promise.resolve(openResult).catch(() => {
					void openStandaloneWindow();
				});
				return;
			}
		} catch {
			// Fall back to standalone popup window when openPopup throws synchronously
		}

		void openStandaloneWindow();
	});
}

export default defineBackground(() => {
	setupBackground();
});
