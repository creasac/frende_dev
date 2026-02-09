#!/usr/bin/env bash
set -euo pipefail

run_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
    return
  fi

  if [[ -x "./node_modules/.bin/supabase" ]]; then
    ./node_modules/.bin/supabase "$@"
    return
  fi

  npx supabase "$@"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line
    line="$(trim "$raw_line")"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      if [[ -z "${!key+x}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$file_path"
}

echo "==> Start local Supabase"
run_supabase start

echo "==> Reset local DB from migrations"
# Keep DB tests deterministic: reset local schema to repository migrations every run.
# `yes` is terminated by SIGPIPE once `supabase db reset` closes stdin.
# With global `set -o pipefail`, that can surface as exit 141 in CI.
set +o pipefail
yes | run_supabase db reset --local --no-seed
set -o pipefail

echo "==> Export local Supabase env"
status_env="$(run_supabase status -o env 2>/dev/null || true)"
if [[ -n "$status_env" ]]; then
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="$(trim "$raw_line")"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done <<< "$status_env"
fi

# Support Supabase CLI output variants.
if [[ -n "${API_URL:-}" ]]; then
  export SUPABASE_URL="$API_URL"
fi
if [[ -n "${PUBLISHABLE_KEY:-}" ]]; then
  export SUPABASE_ANON_KEY="$PUBLISHABLE_KEY"
elif [[ -n "${ANON_KEY:-}" ]]; then
  export SUPABASE_ANON_KEY="$ANON_KEY"
fi
if [[ -n "${SECRET_KEY:-}" ]]; then
  export SUPABASE_SERVICE_ROLE_KEY="$SECRET_KEY"
elif [[ -n "${SERVICE_ROLE_KEY:-}" ]]; then
  export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
fi

# Fallback to local env files used by DB tests.
load_env_file ".env.test.local"
load_env_file ".env.test"

required=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY)
missing=()
for var in "${required[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "DB/RLS tests not run. Missing env vars: ${missing[*]}"
  echo "Check local Supabase status: supabase status -o env"
  exit 1
fi

host="${SUPABASE_URL#*://}"
host="${host%%[:/]*}"
case "$host" in
  localhost|127.0.0.1|0.0.0.0|::1)
    ;;
  *)
    echo "Refusing to run DB tests against non-local SUPABASE_URL host: $host"
    echo "Use local Supabase (expected host localhost/127.0.0.1)."
    exit 1
    ;;
esac

echo "==> DB/RLS tests"
npm run test:db
