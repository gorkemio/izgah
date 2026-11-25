#!/usr/bin/env bash
set -euo pipefail
umask 077

# Host-side daily off-box backup script.
# Runs pg_dump -Fc and archives MEDIA_STORAGE_DIR (/data/thumbnails) back-to-back within
# the same maintenance window, uploads both to an S3-compatible destination, and prunes
# local and remote backups older than BACKUP_RETENTION_DAYS.

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

if [[ -z "${DATABASE_URL:-}" ]]; then
	log_json "error" "DATABASE_URL must be set" >&2
	exit 1
fi

if [[ -z "${MEDIA_STORAGE_DIR:-}" ]]; then
	log_json "error" "MEDIA_STORAGE_DIR must be set" >&2
	exit 1
fi

if [[ -z "${BACKUP_DIR:-}" ]]; then
	log_json "error" "BACKUP_DIR must be set" >&2
	exit 1
fi

if [[ -z "${BACKUP_S3_URI:-}" ]]; then
	log_json "error" "BACKUP_S3_URI must be set" >&2
	exit 1
fi

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
if ! [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
	log_json "error" "BACKUP_RETENTION_DAYS must be a positive integer" >&2
	exit 1
fi

if [[ ! -d "$MEDIA_STORAGE_DIR" ]]; then
	log_json "error" "MEDIA_STORAGE_DIR directory does not exist" >&2
	exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
	log_json "error" "pg_dump binary not found on host PATH" >&2
	exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
	log_json "error" "tar binary not found on host PATH" >&2
	exit 1
fi

UPLOAD_TOOL=""
if [[ "$BACKUP_S3_URI" == s3://* ]] && command -v aws >/dev/null 2>&1; then
	UPLOAD_TOOL="aws"
elif command -v rclone >/dev/null 2>&1; then
	UPLOAD_TOOL="rclone"
elif command -v aws >/dev/null 2>&1; then
	UPLOAD_TOOL="aws"
else
	log_json "error" "Neither aws CLI nor rclone is installed for S3 upload" >&2
	exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_DIR_CLEAN="${BACKUP_DIR%/}"
LOCK_DIR=""
TMP_DUMP=""
TMP_TAR=""
TMP_MANIFEST=""

cleanup() {
	rm -f "${TMP_DUMP:-}" "${TMP_TAR:-}" "${TMP_MANIFEST:-}"
	if [[ -n "$LOCK_DIR" ]]; then
		rmdir "$LOCK_DIR" 2>/dev/null || true
	fi
}
trap cleanup EXIT

if command -v flock >/dev/null 2>&1; then
	exec 9>"${BACKUP_DIR_CLEAN}/.offbox-backup.lock"
	if ! flock -n 9; then
		log_json "error" "Another offbox-backup.sh run is already active" >&2
		exit 1
	fi
else
	LOCK_DIR="${BACKUP_DIR_CLEAN}/.offbox-backup.lockdir"
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		log_json "error" "Another offbox-backup.sh run is already active" >&2
		exit 1
	fi
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_NAME="izgah-db-${TIMESTAMP}.dump"
MEDIA_NAME="izgah-thumbnails-${TIMESTAMP}.tar.gz"
MANIFEST_NAME="izgah-manifest-${TIMESTAMP}.sha256"

DUMP_FILE="${BACKUP_DIR_CLEAN}/${DUMP_NAME}"
MEDIA_FILE="${BACKUP_DIR_CLEAN}/${MEDIA_NAME}"
MANIFEST_FILE="${BACKUP_DIR_CLEAN}/${MANIFEST_NAME}"

TMP_DUMP="${DUMP_FILE}.tmp.$$"
TMP_TAR="${MEDIA_FILE}.tmp.$$"
TMP_MANIFEST="${MANIFEST_FILE}.tmp.$$"

log_json "info" "Starting PostgreSQL dump for off-box backup"
pg_dump --format=custom --no-owner --no-acl --file="$TMP_DUMP" "$DATABASE_URL"

if [[ ! -s "$TMP_DUMP" ]]; then
	log_json "error" "Generated database dump is empty" >&2
	exit 1
fi

if command -v pg_restore >/dev/null 2>&1; then
	pg_restore --list "$TMP_DUMP" >/dev/null
fi
mv "$TMP_DUMP" "$DUMP_FILE"

log_json "info" "Archiving persistent thumbnail cache back-to-back"
MEDIA_PARENT="$(dirname "$MEDIA_STORAGE_DIR")"
MEDIA_BASE="$(basename "$MEDIA_STORAGE_DIR")"
set +e
tar --exclude='.*.tmp' -czf "$TMP_TAR" -C "$MEDIA_PARENT" "$MEDIA_BASE"
tar_exit=$?
set -e
# GNU tar exits with 1 if a file changed while reading; exit >1 is a fatal error.
if [[ "$tar_exit" -gt 1 ]]; then
	log_json "error" "Failed to archive MEDIA_STORAGE_DIR" "\"tar_exit\":${tar_exit}" >&2
	exit "$tar_exit"
fi
if [[ ! -s "$TMP_TAR" ]]; then
	log_json "error" "Generated thumbnail archive is empty" >&2
	exit 1
fi
mv "$TMP_TAR" "$MEDIA_FILE"

if command -v sha256sum >/dev/null 2>&1; then
	(cd "$BACKUP_DIR_CLEAN" && sha256sum "$DUMP_NAME" "$MEDIA_NAME" >"$(basename "$TMP_MANIFEST")")
elif command -v shasum >/dev/null 2>&1; then
	(cd "$BACKUP_DIR_CLEAN" && shasum -a 256 "$DUMP_NAME" "$MEDIA_NAME" >"$(basename "$TMP_MANIFEST")")
else
	log_json "error" "Neither sha256sum nor shasum is installed" >&2
	exit 1
fi
mv "$TMP_MANIFEST" "$MANIFEST_FILE"

S3_PREFIX="${BACKUP_S3_URI%/}"
aws_cmd() {
	if [[ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]]; then
		aws --endpoint-url "$BACKUP_S3_ENDPOINT_URL" "$@"
	else
		aws "$@"
	fi
}

log_json "info" "Uploading backup artifacts to off-box S3 destination" "\"tool\":\"${UPLOAD_TOOL}\""
if [[ "$UPLOAD_TOOL" == "aws" ]]; then
	aws_cmd s3 cp "$DUMP_FILE" "${S3_PREFIX}/${DUMP_NAME}" --only-show-errors
	aws_cmd s3 cp "$MEDIA_FILE" "${S3_PREFIX}/${MEDIA_NAME}" --only-show-errors
	aws_cmd s3 cp "$MANIFEST_FILE" "${S3_PREFIX}/${MANIFEST_NAME}" --only-show-errors
else
	rclone copyto "$DUMP_FILE" "${S3_PREFIX}/${DUMP_NAME}"
	rclone copyto "$MEDIA_FILE" "${S3_PREFIX}/${MEDIA_NAME}"
	rclone copyto "$MANIFEST_FILE" "${S3_PREFIX}/${MANIFEST_NAME}"
fi

log_json "info" "Pruning local and remote backups past retention window" "\"retention_days\":${BACKUP_RETENTION_DAYS}"
find "$BACKUP_DIR_CLEAN" -maxdepth 1 -type f -name 'izgah-*' -mtime +"$BACKUP_RETENTION_DAYS" -delete

if [[ "$UPLOAD_TOOL" == "aws" ]]; then
	CUTOFF_EPOCH=$(( $(date -u +%s) - BACKUP_RETENTION_DAYS * 86400 ))
	S3_REST="${S3_PREFIX#s3://}"
	S3_BUCKET="${S3_REST%%/*}"
	S3_KEY_PREFIX=""
	if [[ "$S3_REST" == */* ]]; then
		S3_KEY_PREFIX="${S3_REST#*/}/"
	fi

	while read -r obj_date obj_time _obj_size obj_name; do
		[[ -n "${obj_name:-}" ]] || continue
		if [[ "$obj_name" != izgah-* ]]; then
			continue
		fi
		obj_epoch=""
		if obj_epoch="$(date -u -d "${obj_date} ${obj_time}" +%s 2>/dev/null)"; then
			:
		elif obj_epoch="$(date -u -j -f '%Y-%m-%d %H:%M:%S' "${obj_date} ${obj_time}" +%s 2>/dev/null)"; then
			:
		else
			continue
		fi
		if [[ "$obj_epoch" -lt "$CUTOFF_EPOCH" ]]; then
			aws_cmd s3 rm "s3://${S3_BUCKET}/${S3_KEY_PREFIX}${obj_name}" --only-show-errors
		fi
	done < <(aws_cmd s3 ls "${S3_PREFIX}/")
else
	rclone delete --min-age "${BACKUP_RETENTION_DAYS}d" "$S3_PREFIX" --include 'izgah-*'
fi

DUMP_BYTES="$(wc -c <"$DUMP_FILE" | tr -d '[:space:]')"
MEDIA_BYTES="$(wc -c <"$MEDIA_FILE" | tr -d '[:space:]')"
log_json "info" "Off-box backup cycle completed" \
	"\"dump_file\":\"$(json_escape "$DUMP_NAME")\",\"dump_bytes\":${DUMP_BYTES},\"media_file\":\"$(json_escape "$MEDIA_NAME")\",\"media_bytes\":${MEDIA_BYTES}"
