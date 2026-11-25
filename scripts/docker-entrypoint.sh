#!/bin/sh
set -eu

log_json() {
	level="$1"
	msg="$2"
	extra="${3:-}"
	ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	if [ -n "$extra" ]; then
		printf '{"timestamp":"%s","level":"%s","request_id":null,"user_id":null,"channel":"system","client_version":null,"msg":"%s",%s}\n' \
			"$ts" "$level" "$msg" "$extra"
	else
		printf '{"timestamp":"%s","level":"%s","request_id":null,"user_id":null,"channel":"system","client_version":null,"msg":"%s"}\n' \
			"$ts" "$level" "$msg"
	fi
}

fail_startup() {
	log_json "error" "$1" "${2:-}" >&2
	exit 1
}

if [ -z "${DATABASE_URL:-}" ]; then
	fail_startup "Startup failed: missing required environment variable" '"field":"DATABASE_URL"'
fi

if [ -z "${BETTER_AUTH_SECRET:-}" ] || [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
	fail_startup "Startup failed: BETTER_AUTH_SECRET must be at least 32 characters" '"field":"BETTER_AUTH_SECRET"'
fi
if [ "${BETTER_AUTH_SECRET}" = "replace-with-at-least-32-char-random-secret" ]; then
	fail_startup "Startup failed: BETTER_AUTH_SECRET is the public example value; generate one with: openssl rand -base64 32" '"field":"BETTER_AUTH_SECRET"'
fi

if [ "${NODE_ENV:-production}" = "production" ] && [ -z "${ORIGIN:-}" ]; then
	fail_startup "Startup failed: missing required environment variable in production" '"field":"ORIGIN"'
fi

MEDIA_DIR="${MEDIA_STORAGE_DIR:-/data/thumbnails}"
if ! mkdir -p "$MEDIA_DIR"; then
	fail_startup "Startup failed: unable to create MEDIA_STORAGE_DIR" '"field":"MEDIA_STORAGE_DIR"'
fi

if [ ! -d "$MEDIA_DIR" ] || [ ! -w "$MEDIA_DIR" ]; then
	fail_startup "Startup failed: MEDIA_STORAGE_DIR is not writable" '"field":"MEDIA_STORAGE_DIR"'
fi

PROBE_FILE="${MEDIA_DIR%/}/.entrypoint-probe.$$"
if ! : >"$PROBE_FILE" 2>/dev/null || ! rm -f "$PROBE_FILE" 2>/dev/null; then
	fail_startup "Startup failed: MEDIA_STORAGE_DIR write/delete probe failed" '"field":"MEDIA_STORAGE_DIR"'
fi

log_json "info" "Running database migrations under advisory lock"
node build/migrate.js

log_json "info" "Starting Izgah application server"
if [ "$#" -gt 0 ]; then
	exec "$@"
fi

exec node build/index.js
