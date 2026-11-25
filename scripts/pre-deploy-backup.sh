#!/usr/bin/env bash
set -euo pipefail
umask 077

# Host-side pre-deploy backup script.
# Dokploy single-Dockerfile apps do not provide a host-side pre-deploy hook, so run this
# manually on the host immediately before pushing new drizzle/ schema migrations to main.

log_json() {
	local level="$1"
	local msg="$2"
	local extra="${3:-}"
	local ts
	ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	if [[ -n "$extra" ]]; then
		printf '{"timestamp":"%s","level":"%s","request_id":null,"user_id":null,"channel":"backup","client_version":null,"msg":"%s",%s}\n' \
			"$ts" "$level" "$msg" "$extra"
	else
		printf '{"timestamp":"%s","level":"%s","request_id":null,"user_id":null,"channel":"backup","client_version":null,"msg":"%s"}\n' \
			"$ts" "$level" "$msg"
	fi
}

json_escape() {
	local val="$1"
	val="${val//\\/\\\\}"
	val="${val//\"/\\\"}"
	printf '%s' "$val"
}

compute_sha256_file() {
	local target_file="$1"
	local out_file="$2"
	local dir_name base_name
	dir_name="$(dirname "$target_file")"
	base_name="$(basename "$target_file")"

	if command -v sha256sum >/dev/null 2>&1; then
		(cd "$dir_name" && sha256sum "$base_name" >"$(basename "$out_file")")
	elif command -v shasum >/dev/null 2>&1; then
		(cd "$dir_name" && shasum -a 256 "$base_name" >"$(basename "$out_file")")
	else
		log_json "error" "Neither sha256sum nor shasum is installed" >&2
		exit 1
	fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
	log_json "error" "DATABASE_URL must be set on host environment" >&2
	exit 1
fi

if [[ -z "${BACKUP_DIR:-}" ]]; then
	log_json "error" "BACKUP_DIR must be set on host environment" >&2
	exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
	log_json "error" "pg_dump binary not found on host PATH" >&2
	exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR_CLEAN="${BACKUP_DIR%/}"
DUMP_FILE="${BACKUP_DIR_CLEAN}/izgah-pre-deploy-${TIMESTAMP}.dump"
TMP_FILE="${DUMP_FILE}.tmp.$$"
CHECKSUM_FILE="${DUMP_FILE}.sha256"

cleanup() {
	rm -f "$TMP_FILE"
}
trap cleanup EXIT

log_json "info" "Starting host pre-deploy pg_dump backup"
pg_dump --format=custom --no-owner --no-acl --file="$TMP_FILE" "$DATABASE_URL"

if [[ ! -s "$TMP_FILE" ]]; then
	log_json "error" "Generated pre-deploy dump file is empty" >&2
	exit 1
fi

if command -v pg_restore >/dev/null 2>&1; then
	pg_restore --list "$TMP_FILE" >/dev/null
fi

mv "$TMP_FILE" "$DUMP_FILE"
compute_sha256_file "$DUMP_FILE" "$CHECKSUM_FILE"

DUMP_BYTES="$(wc -c <"$DUMP_FILE" | tr -d '[:space:]')"
log_json "info" "Pre-deploy pg_dump backup completed" \
	"\"file\":\"$(json_escape "$DUMP_FILE")\",\"checksum_file\":\"$(json_escape "$CHECKSUM_FILE")\",\"bytes\":${DUMP_BYTES}"
