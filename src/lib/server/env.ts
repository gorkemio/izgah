import fs from 'node:fs';
import { building } from '$app/env';
import { z } from 'zod';
import { LOCALES } from '#lib/i18n/locales.ts';
import {
	DEFAULT_INSTANCE_NAME,
	DEFAULT_SOURCE_URL,
	DEFAULT_TIME_ZONE,
	isValidTimeZone,
	registerServerInstanceConfig
} from '#lib/instance.ts';

/** Example values shipped in .env.example; an instance must never run with a public secret. */
const KNOWN_PLACEHOLDER_SECRETS = new Set(['replace-with-at-least-32-char-random-secret']);

/** ORIGIN and SOURCE_URL end up in links and CSRF checks, so only http(s) URLs are accepted. */
const httpUrlSchema = z.url({ protocol: /^https?$/ });

const emptyToUndefined = (value: unknown): unknown => {
	if (typeof value === 'string' && value.trim() === '') {
		return undefined;
	}
	return value;
};

const postgresUrlSchema = z
	.string()
	.url()
	.refine((url) => url.startsWith('postgres://') || url.startsWith('postgresql://'), {
		message: 'Must be a PostgreSQL connection URL'
	});

const baseEnvSchema = z.object({
	NODE_ENV: z.preprocess(
		emptyToUndefined,
		z.enum(['development', 'test', 'production']).default('development')
	),
	DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrlSchema),
	TEST_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrlSchema.optional()),
	DATABASE_POOL_MAX: z.preprocess(
		emptyToUndefined,
		z.coerce.number().int().min(1).max(100).default(12)
	),
	BETTER_AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32)),
	ORIGIN: z.preprocess(emptyToUndefined, httpUrlSchema.optional()),
	HOST: z.preprocess(emptyToUndefined, z.string().min(1).default('0.0.0.0')),
	PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(3000)),
	ADDRESS_HEADER: z.preprocess(emptyToUndefined, z.string().min(1).default('x-forwarded-for')),
	XFF_DEPTH: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10).default(1)),
	MEDIA_STORAGE_DIR: z.preprocess(
		emptyToUndefined,
		z.string().min(1).default('./.local-data/thumbnails')
	),
	MEDIA_MIN_FREE_BYTES: z.preprocess(
		emptyToUndefined,
		z.coerce.number().int().nonnegative().default(536870912)
	),
	MEDIA_MIN_FREE_RATIO: z.preprocess(
		emptyToUndefined,
		z.coerce.number().min(0).max(1).default(0.15)
	),
	ADMIN_BOOTSTRAP_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
	GITHUB_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
	UNFURL_CONCURRENCY: z.preprocess(
		emptyToUndefined,
		z.coerce.number().int().min(1).max(20).default(3)
	),
	LOG_LEVEL: z.preprocess(
		emptyToUndefined,
		z.enum(['debug', 'info', 'warn', 'error']).default('info')
	),
	DEFAULT_LOCALE: z.preprocess(emptyToUndefined, z.enum(LOCALES).default('en')),
	APP_TIME_ZONE: z.preprocess(
		emptyToUndefined,
		z
			.string()
			.refine(isValidTimeZone, { message: 'Must be an IANA time zone such as Europe/Istanbul' })
			.default(DEFAULT_TIME_ZONE)
	),
	INSTANCE_NAME: z.preprocess(
		emptyToUndefined,
		z.string().trim().min(1).max(40).default(DEFAULT_INSTANCE_NAME)
	),
	SOURCE_URL: z.preprocess(emptyToUndefined, httpUrlSchema.default(DEFAULT_SOURCE_URL))
});

function createEnvSchema(isCliMode: boolean) {
	return baseEnvSchema.superRefine((val, ctx) => {
		if (val.NODE_ENV === 'production' && !val.ORIGIN && !isCliMode) {
			ctx.addIssue({
				code: 'custom',
				path: ['ORIGIN'],
				message: 'Required in production'
			});
		}
		if (val.NODE_ENV === 'production' && KNOWN_PLACEHOLDER_SECRETS.has(val.BETTER_AUTH_SECRET)) {
			ctx.addIssue({
				code: 'custom',
				path: ['BETTER_AUTH_SECRET'],
				message: 'Replace the example secret with a random value (openssl rand -base64 32)'
			});
		}
		if (val.NODE_ENV === 'test' && !val.TEST_DATABASE_URL) {
			ctx.addIssue({
				code: 'custom',
				path: ['TEST_DATABASE_URL'],
				message: 'Required in test'
			});
		}
	});
}

export type Env = z.infer<typeof baseEnvSchema>;

export type EnvValidationResult = { ok: true; data: Env } | { ok: false; fields: string[] };

export function validateEnv(rawEnv: NodeJS.ProcessEnv): EnvValidationResult {
	const parsed = createEnvSchema(rawEnv.IZGAH_CLI_MODE === '1').safeParse(rawEnv);
	if (parsed.success) {
		return { ok: true, data: parsed.data };
	}

	const fields = Array.from(
		new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'UNKNOWN')))
	).sort();

	return { ok: false, fields };
}

const buildPlaceholderEnv: Env = {
	NODE_ENV: 'production',
	DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5432/izgah',
	TEST_DATABASE_URL: undefined,
	DATABASE_POOL_MAX: 12,
	BETTER_AUTH_SECRET: 'placeholder-secret-only-used-during-sveltekit-build',
	ORIGIN: 'http://localhost:3000',
	HOST: '0.0.0.0',
	PORT: 3000,
	ADDRESS_HEADER: 'x-forwarded-for',
	XFF_DEPTH: 1,
	MEDIA_STORAGE_DIR: './.local-data/thumbnails',
	MEDIA_MIN_FREE_BYTES: 536870912,
	MEDIA_MIN_FREE_RATIO: 0.15,
	ADMIN_BOOTSTRAP_EMAIL: undefined,
	GITHUB_TOKEN: undefined,
	UNFURL_CONCURRENCY: 3,
	LOG_LEVEL: 'info',
	DEFAULT_LOCALE: 'en',
	APP_TIME_ZONE: DEFAULT_TIME_ZONE,
	INSTANCE_NAME: DEFAULT_INSTANCE_NAME,
	SOURCE_URL: DEFAULT_SOURCE_URL
};

function resolveRuntimeEnv(): Env {
	if (building) {
		return buildPlaceholderEnv;
	}

	if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test' && fs.existsSync('.env')) {
		process.loadEnvFile('.env');
	}

	const result = validateEnv(process.env);
	if (!result.ok) {
		process.stderr.write(
			JSON.stringify({
				timestamp: new Date().toISOString(),
				level: 'error',
				request_id: null,
				user_id: null,
				channel: 'system',
				client_version: null,
				msg: 'Environment validation failed',
				fields: result.fields
			}) + '\n'
		);
		process.exit(1);
	}

	return result.data;
}

export const env: Env = resolveRuntimeEnv();

registerServerInstanceConfig({
	name: env.INSTANCE_NAME,
	timeZone: env.APP_TIME_ZONE,
	sourceUrl: env.SOURCE_URL
});
