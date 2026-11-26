import crypto from 'node:crypto';

/**
 * Small AES-256-GCM box for secrets stored in the database (instance_settings.secret).
 * The key is derived from BETTER_AUTH_SECRET with HKDF-SHA256, so no extra variable is needed;
 * rotating BETTER_AUTH_SECRET makes stored secrets unreadable (docs/designs/izgah-smart-capture.md §11).
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 */
const VERSION = 'v1';
const HKDF_SALT = 'izgah';
const HKDF_INFO = 'instance-settings-secret-v1';

export class SecretBoxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecretBoxError';
	}
}

function deriveKey(masterSecret: string): Buffer {
	return Buffer.from(crypto.hkdfSync('sha256', masterSecret, HKDF_SALT, HKDF_INFO, 32));
}

export function sealSecret(plaintext: string, masterSecret: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(masterSecret), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [VERSION, iv, tag, ciphertext]
		.map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
		.join('.');
}

export function openSecret(sealed: string, masterSecret: string): string {
	const parts = sealed.split('.');
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new SecretBoxError('Unsupported secret format');
	}
	const [, ivPart, tagPart, dataPart] = parts;
	try {
		const decipher = crypto.createDecipheriv(
			'aes-256-gcm',
			deriveKey(masterSecret),
			Buffer.from(ivPart, 'base64url')
		);
		decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
		return Buffer.concat([
			decipher.update(Buffer.from(dataPart, 'base64url')),
			decipher.final()
		]).toString('utf8');
	} catch {
		throw new SecretBoxError('Secret could not be decrypted');
	}
}
