import { env } from './env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogChannel = 'web' | 'api' | 'system';

export interface LogContext {
	request_id?: string | null;
	user_id?: string | null;
	channel?: LogChannel | null;
	client_version?: string | null;
}

export interface Logger {
	child(context: LogContext): Logger;
	debug(msg: string, fields?: Record<string, unknown>): void;
	info(msg: string, fields?: Record<string, unknown>): void;
	warn(msg: string, fields?: Record<string, unknown>): void;
	error(msg: string, fields?: Record<string, unknown>): void;
}

const LOG_WEIGHTS: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40
};

function shouldLog(level: LogLevel): boolean {
	return LOG_WEIGHTS[level] >= LOG_WEIGHTS[env.LOG_LEVEL];
}

function writeLog(
	level: LogLevel,
	context: LogContext,
	msg: string,
	fields?: Record<string, unknown>
): void {
	if (!shouldLog(level)) {
		return;
	}

	const payload = {
		...(fields ?? {}),
		timestamp: new Date().toISOString(),
		level,
		request_id: context.request_id ?? null,
		user_id: context.user_id ?? null,
		channel: context.channel ?? null,
		client_version: context.client_version ?? null,
		msg
	};

	const line = JSON.stringify(payload) + '\n';
	if (level === 'warn' || level === 'error') {
		process.stderr.write(line);
	} else {
		process.stdout.write(line);
	}
}

export function createLogger(baseContext: LogContext = {}): Logger {
	const context: LogContext = {
		request_id: baseContext.request_id ?? null,
		user_id: baseContext.user_id ?? null,
		channel: baseContext.channel ?? null,
		client_version: baseContext.client_version ?? null
	};

	return {
		child(nextContext: LogContext): Logger {
			return createLogger({
				...context,
				...nextContext
			});
		},
		debug(msg: string, fields?: Record<string, unknown>): void {
			writeLog('debug', context, msg, fields);
		},
		info(msg: string, fields?: Record<string, unknown>): void {
			writeLog('info', context, msg, fields);
		},
		warn(msg: string, fields?: Record<string, unknown>): void {
			writeLog('warn', context, msg, fields);
		},
		error(msg: string, fields?: Record<string, unknown>): void {
			writeLog('error', context, msg, fields);
		}
	};
}

export const logger = createLogger({ channel: 'system' });
