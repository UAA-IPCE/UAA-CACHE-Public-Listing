#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.r2.local"

print_usage() {
  cat <<'EOF'
Usage:
  scripts/r2-deploy.sh build-and-deploy-site [local-dir]
  scripts/r2-deploy.sh deploy-site [local-dir]
  scripts/r2-deploy.sh deploy-file <local-file> [remote-key]
  scripts/r2-deploy.sh pull-site [local-dir]
  scripts/r2-deploy.sh pull-file <remote-key> [local-file]
  scripts/r2-deploy.sh bisync [local-dir] [remote-subdir]
  scripts/r2-deploy.sh bisync-resync [local-dir] [remote-subdir]
  scripts/r2-deploy.sh bisync-dry-run [local-dir] [remote-subdir]

Environment:
  Set R2_ENV_FILE=/path/to/.env.r2.local to override the default env file.
EOF
}

load_env() {
  local env_file="${R2_ENV_FILE:-$DEFAULT_ENV_FILE}"

  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local missing=0
  local key

  for key in "$@"; do
    if [[ -z "${!key:-}" ]]; then
      echo "Missing required env var: $key" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

trim_leading_slash() {
  local value="${1:-}"
  echo "${value#/}"
}

trim_trailing_slash() {
  local value="${1:-}"
  echo "${value%/}"
}

build_s3_uri() {
  local key="$(trim_leading_slash "${1:-}")"
  local prefix="$(trim_leading_slash "${CF_R2_REMOTE_PREFIX:-}")"
  local base="s3://${CF_R2_BUCKET_NAME}"

  if [[ -n "$prefix" ]]; then
    base="$base/$prefix"
  fi

  if [[ -n "$key" ]]; then
    echo "$base/$key"
  else
    echo "$base"
  fi
}

configure_aws() {
  export AWS_ACCESS_KEY_ID="$CF_R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$CF_R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="${CF_R2_BUCKET_REGION:-auto}"
}

aws_r2() {
  aws --endpoint-url "$CF_R2_ENDPOINT" "$@"
}

configure_rclone() {
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_TYPE="s3"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_PROVIDER="Cloudflare"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_ACCESS_KEY_ID="$CF_R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_SECRET_ACCESS_KEY="$CF_R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_ENDPOINT="$CF_R2_ENDPOINT"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_REGION="${CF_R2_BUCKET_REGION:-auto}"
  export RCLONE_CONFIG_${CF_R2_RCLONE_REMOTE^^}_ACL="private"
}

build_rclone_target() {
  local remote_subdir="$(trim_leading_slash "${1:-}")"
  local prefix="$(trim_leading_slash "${CF_R2_REMOTE_PREFIX:-}")"
  local target="${CF_R2_RCLONE_REMOTE}:${CF_R2_BUCKET_NAME}"

  if [[ -n "$prefix" ]]; then
    target="$target/$prefix"
  fi

  if [[ -n "$remote_subdir" ]]; then
    target="$target/$remote_subdir"
  fi

  echo "$target"
}

deploy_site() {
  local local_dir="${1:-${CF_R2_LOCAL_SITE_DIR:-dist}}"

  require_command aws
  require_env CF_R2_BUCKET_NAME CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY CF_R2_ENDPOINT
  configure_aws

  if [[ ! -d "$ROOT_DIR/$local_dir" && ! -d "$local_dir" ]]; then
    echo "Local site directory not found: $local_dir" >&2
    exit 1
  fi

  local resolved_dir="$local_dir"
  if [[ -d "$ROOT_DIR/$local_dir" ]]; then
    resolved_dir="$ROOT_DIR/$local_dir"
  fi

  aws_r2 s3 sync "$resolved_dir" "$(build_s3_uri)" --delete
}

build_and_deploy_site() {
  require_command npm
  (cd "$ROOT_DIR" && npm run build)
  deploy_site "${1:-${CF_R2_LOCAL_SITE_DIR:-dist}}"
}

deploy_file() {
  local local_file="${1:-}"
  local remote_key="${2:-}"

  require_command aws
  require_env CF_R2_BUCKET_NAME CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY CF_R2_ENDPOINT
  configure_aws

  if [[ -z "$local_file" ]]; then
    echo "deploy-file requires a local file path" >&2
    exit 1
  fi

  if [[ ! -f "$local_file" && ! -f "$ROOT_DIR/$local_file" ]]; then
    echo "Local file not found: $local_file" >&2
    exit 1
  fi

  local resolved_file="$local_file"
  if [[ -f "$ROOT_DIR/$local_file" ]]; then
    resolved_file="$ROOT_DIR/$local_file"
  fi

  if [[ -z "$remote_key" ]]; then
    remote_key="$(basename "$resolved_file")"
  fi

  aws_r2 s3 cp "$resolved_file" "$(build_s3_uri "$remote_key")" \
    --cache-control "${CF_R2_SINGLE_FILE_CACHE_CONTROL:-public, max-age=300}"
}

pull_site() {
  local local_dir="${1:-${CF_R2_LOCAL_SYNC_DIR:-./r2-sync}}"

  require_command aws
  require_env CF_R2_BUCKET_NAME CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY CF_R2_ENDPOINT
  configure_aws

  mkdir -p "$ROOT_DIR/$local_dir"
  aws_r2 s3 sync "$(build_s3_uri)" "$ROOT_DIR/$local_dir"
}

pull_file() {
  local remote_key="${1:-}"
  local local_file="${2:-}"

  require_command aws
  require_env CF_R2_BUCKET_NAME CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY CF_R2_ENDPOINT
  configure_aws

  if [[ -z "$remote_key" ]]; then
    echo "pull-file requires a remote object key" >&2
    exit 1
  fi

  if [[ -z "$local_file" ]]; then
    local_file="$ROOT_DIR/$(basename "$remote_key")"
  elif [[ "$local_file" != /* ]]; then
    local_file="$ROOT_DIR/$local_file"
  fi

  mkdir -p "$(dirname "$local_file")"
  aws_r2 s3 cp "$(build_s3_uri "$remote_key")" "$local_file"
}

bisync_site() {
  local mode="${1:-normal}"
  local local_dir="${2:-${CF_R2_LOCAL_SYNC_DIR:-./r2-sync}}"
  local remote_subdir="${3:-}"

  require_command rclone
  require_env CF_R2_BUCKET_NAME CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY CF_R2_ENDPOINT CF_R2_RCLONE_REMOTE
  configure_rclone

  if [[ "$local_dir" != /* ]]; then
    local_dir="$ROOT_DIR/$local_dir"
  fi

  mkdir -p "$local_dir"

  local -a args=(bisync "$local_dir" "$(build_rclone_target "$remote_subdir")" --create-empty-src-dirs --resilient)

  if [[ "$mode" == "dry-run" ]]; then
    args+=(--dry-run)
  fi

  if [[ "$mode" == "resync" ]]; then
    args+=(--resync)
  fi

  rclone "${args[@]}"
}

main() {
  local command="${1:-}"
  load_env

  case "$command" in
    build-and-deploy-site)
      shift
      build_and_deploy_site "$@"
      ;;
    deploy-site)
      shift
      deploy_site "$@"
      ;;
    deploy-file)
      shift
      deploy_file "$@"
      ;;
    pull-site)
      shift
      pull_site "$@"
      ;;
    pull-file)
      shift
      pull_file "$@"
      ;;
    bisync)
      shift
      bisync_site normal "$@"
      ;;
    bisync-resync)
      shift
      bisync_site resync "$@"
      ;;
    bisync-dry-run)
      shift
      bisync_site dry-run "$@"
      ;;
    ""|help|--help|-h)
      print_usage
      ;;
    *)
      echo "Unknown command: $command" >&2
      print_usage >&2
      exit 1
      ;;
  esac
}

main "$@"