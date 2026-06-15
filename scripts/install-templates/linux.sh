#!/usr/bin/env sh
set -eu

DEFAULT_VERSION="<<DEFAULT_VERSION>>"
PLATFORM="linux-x64"
REPO="docstube/docstube"
INSTALL_DIR="${DOCSTUBE_INSTALL_DIR:-$HOME/.docstube/bin}"
VERSION="${DOCSTUBE_VERSION:-$DEFAULT_VERSION}"
EVENTS_URL="${DOCSTUBE_INSTALL_EVENTS_URL:-https://events.docstube.dev/v1/install}"
INSTALL_ID="${DOCSTUBE_INSTALL_ID:-}"

if [ -z "$VERSION" ]; then
  echo "DOCSTUBE_VERSION is required." >&2
  exit 1
fi

if [ -z "$INSTALL_ID" ]; then
  if command -v uuidgen >/dev/null 2>&1; then
    INSTALL_ID="$(uuidgen)"
  else
    INSTALL_ID="$(date +%s)-$$"
  fi
fi

safe_version="$VERSION"
case "$safe_version" in
  *[!A-Za-z0-9._-]*) safe_version="custom" ;;
esac

started_at="$(date +%s)"
install_result="failed"
install_error="unexpected"

track_install() {
  status="$1"
  error_kind="${2:-}"

  if [ "${DO_NOT_TRACK:-}" = "1" ] || [ "${DOCSTUBE_TELEMETRY:-}" = "0" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  now="$(date +%s)"
  duration_ms=$(((now - started_at) * 1000))
  payload="$(printf '{"installId":"%s","status":"%s","version":"%s","platform":"%s","installer":"%s","source":"github-release","durationMs":%s,"errorKind":"%s"}' "$INSTALL_ID" "$status" "$safe_version" "$PLATFORM" "linux.sh" "$duration_ms" "$error_kind")"
  curl -fsS -m 2 -H "content-type: application/json" -d "$payload" "$EVENTS_URL" >/dev/null 2>&1 || true
}

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
  if [ "$install_result" = "failed" ]; then
    track_install failed "$install_error"
  fi
}
trap cleanup EXIT

track_install started

asset="docstube-v${VERSION}-${PLATFORM}.tar.gz"
url="https://github.com/${REPO}/releases/download/v${VERSION}/${asset}"

mkdir -p "$INSTALL_DIR"
install_error="download_failed"
curl -fsSL "$url" -o "$tmp_dir/$asset"
install_error="extract_failed"
tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
install_error="copy_failed"
install -m 755 "$tmp_dir/docstube" "$INSTALL_DIR/docstube"

install_error="verify_failed"
"$INSTALL_DIR/docstube" --version >/dev/null
install_result="succeeded"
track_install succeeded
echo "docstube ${VERSION} installed to $INSTALL_DIR/docstube"
echo "Add $INSTALL_DIR to PATH if docstube is not already available."
