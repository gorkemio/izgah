declare global {
	namespace App {
		interface Error {
			message: string;
			requestId?: string;
		}

		interface Locals {
			requestId: string;
			user: {
				id: string;
				name: string;
				email: string;
				role: 'member' | 'admin';
				authVersion: number;
				/** Profile photo (izgah-ui-v5.md §10.2); loaded for cookie sessions only. */
				avatarAssetKey?: string | null;
			} | null;
			session: {
				id: string;
				expiresAt: Date;
			} | null;
			authChannel: 'cookie' | 'api_key' | null;
			apiKeyId: string | null;
		}
	}
}

export {};
