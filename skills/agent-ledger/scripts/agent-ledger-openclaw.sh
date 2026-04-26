#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  agent-ledger-openclaw.sh check
  agent-ledger-openclaw.sh preview
  agent-ledger-openclaw.sh run
  agent-ledger-openclaw.sh interpret
  agent-ledger-openclaw.sh execute <run_id>
  agent-ledger-openclaw.sh list [limit]
  agent-ledger-openclaw.sh doctor

Required environment variables:
  AGENT_LEDGER_REPO    Local git clone to operate on
  CURSOR_API_KEY       Cursor API key used by agent-ledger

Required for preview, run, interpret, and doctor:
  AGENT_LEDGER_ISSUE   GitHub issue URL or issue number

Optional environment variables:
  AGENT_LEDGER_PROMPT       Extra instruction for the coding agent
  AGENT_LEDGER_CHECK        Repeatable check command is not supported by this wrapper; call agent-ledger directly for multiple checks
  AGENT_LEDGER_POST         true to allow GitHub comments; default is no-post
  AGENT_LEDGER_CLARITY      off | auto | required (default: auto)
  AGENT_LEDGER_LIMIT        Default list limit when list limit arg is omitted
  AGENT_LEDGER_CURSOR_MODEL Override coding model

Examples:
  ./agent-ledger-openclaw.sh check
  AGENT_LEDGER_ISSUE=https://github.com/org/repo/issues/184 AGENT_LEDGER_REPO=/repo ./agent-ledger-openclaw.sh preview
  AGENT_LEDGER_ISSUE=184 AGENT_LEDGER_REPO=/repo ./agent-ledger-openclaw.sh run
  AGENT_LEDGER_REPO=/repo ./agent-ledger-openclaw.sh execute 20260102-120000-issue-184
EOF
}

require_repo() {
  : "${AGENT_LEDGER_REPO:?AGENT_LEDGER_REPO is required}"
}

require_cursor_key() {
  : "${CURSOR_API_KEY:?CURSOR_API_KEY is required}"
}

require_issue() {
  : "${AGENT_LEDGER_ISSUE:?AGENT_LEDGER_ISSUE is required}"
}

require_bins() {
  local missing=()
  for bin in agent-ledger gh git; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      missing+=("$bin")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "Missing required command(s): ${missing[*]}" >&2
    exit 1
  fi
}

post_flag() {
  if [[ "${AGENT_LEDGER_POST:-false}" == "true" ]]; then
    return 0
  fi
  printf '%s\n' "--no-post"
}

common_issue_args() {
  require_repo
  require_issue
  printf '%s\0' --issue "$AGENT_LEDGER_ISSUE" --repo "$AGENT_LEDGER_REPO"
  if [[ -n "${AGENT_LEDGER_PROMPT:-}" ]]; then
    printf '%s\0' --prompt "$AGENT_LEDGER_PROMPT"
  fi
  if [[ -n "${AGENT_LEDGER_CHECK:-}" ]]; then
    printf '%s\0' --check "$AGENT_LEDGER_CHECK"
  fi
  if [[ -n "${AGENT_LEDGER_CLARITY:-}" ]]; then
    printf '%s\0' --clarity "$AGENT_LEDGER_CLARITY"
  fi
  if [[ -n "${AGENT_LEDGER_CURSOR_MODEL:-}" ]]; then
    printf '%s\0' --cursor-model "$AGENT_LEDGER_CURSOR_MODEL"
  fi
}

run_with_nul_args() {
  local -a args=()
  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done
  agent-ledger "${args[@]}"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"
  shift || true

  if [[ "$cmd" == "-h" || "$cmd" == "--help" || "$cmd" == "help" ]]; then
    usage
    exit 0
  fi

  require_bins

  case "$cmd" in
    check)
      require_bins
      agent-ledger --version 2>&1 | head -n 1
      if ! gh auth status >/dev/null 2>&1; then
        echo "gh: not authenticated. Set GH_TOKEN or GITHUB_TOKEN in this environment, or run gh auth login on the host." >&2
        exit 1
      fi
      echo "ok: required tools on PATH, gh session active"
      ;;
    preview)
      require_cursor_key
      { printf '%s\0' run; common_issue_args; printf '%s\0' --dry-run --json; } | run_with_nul_args
      ;;
    run)
      require_cursor_key
      {
        printf '%s\0' run
        common_issue_args
        printf '%s\0' --yes --json
        local maybe_no_post
        maybe_no_post="$(post_flag || true)"
        [[ -z "$maybe_no_post" ]] || printf '%s\0' "$maybe_no_post"
      } | run_with_nul_args
      ;;
    interpret)
      require_cursor_key
      {
        printf '%s\0' interpret
        common_issue_args
        printf '%s\0' --json
        local maybe_no_post
        maybe_no_post="$(post_flag || true)"
        [[ -z "$maybe_no_post" ]] || printf '%s\0' "$maybe_no_post"
      } | run_with_nul_args
      ;;
    execute)
      require_repo
      require_cursor_key
      local run_id="${1:-}"
      [[ -n "$run_id" ]] || { usage; exit 1; }
      if [[ "${AGENT_LEDGER_POST:-false}" == "true" ]]; then
        agent-ledger execute --run-id "$run_id" --repo "$AGENT_LEDGER_REPO" --json
      else
        agent-ledger execute --run-id "$run_id" --repo "$AGENT_LEDGER_REPO" --json --no-post
      fi
      ;;
    list)
      require_repo
      local limit="${1:-${AGENT_LEDGER_LIMIT:-50}}"
      if [[ ! "$limit" =~ ^[0-9]+$ ]]; then
        echo "list limit must be a positive integer" >&2
        exit 1
      fi
      agent-ledger runs list --repo "$AGENT_LEDGER_REPO" --limit "$limit" --json
      ;;
    doctor)
      require_repo
      require_issue
      require_cursor_key
      agent-ledger doctor --repo "$AGENT_LEDGER_REPO" --issue "$AGENT_LEDGER_ISSUE" --json
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
