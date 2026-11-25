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
