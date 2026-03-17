#!/usr/bin/env bash
# Upload textures to Cloudflare R2.
#
# Prerequisites:
#   brew install awscli   (or pip install awscli)
#   export R2_ACCESS_KEY_ID=<your key>
#   export R2_SECRET_ACCESS_KEY=<your secret>
#
# Usage:
#   ./scripts/upload-textures.sh          # upload all textures
#   ./scripts/upload-textures.sh --dry    # show what would be uploaded

set -euo pipefail

ENDPOINT="https://308dccfe233cd3fca347a405d48da641.r2.cloudflarestorage.com"
BUCKET="terrashift"
SRC_DIR="public/textures"

# Load credentials from .env.local if present
if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi

if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  echo "Error: Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.local or env vars"
  echo "Create an API token at: Cloudflare Dashboard → R2 → Manage R2 API Tokens"
  exit 1
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

DRY=""
if [[ "${1:-}" == "--dry" ]]; then
  DRY="--dryrun"
  echo "=== DRY RUN ==="
fi

echo "Uploading textures to R2 (${BUCKET})..."

aws s3 sync "$SRC_DIR" "s3://${BUCKET}/textures/" \
  --endpoint-url "$ENDPOINT" \
  --cache-control "public, max-age=31536000, immutable" \
  --size-only \
  $DRY

echo "Done. Set NEXT_PUBLIC_CDN_URL in Vercel to your R2 public URL."
