#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
SECRET_ID="${SECRET_ID:-music-streaming/prod}"

cd "$APP_DIR"

if ! command -v jq >/dev/null 2>&1; then
  sudo dnf install -y jq
fi

SECRET_JSON="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$SECRET_ID" \
  --query SecretString \
  --output text)"

export MONGODB_URI="$(echo "$SECRET_JSON" | jq -r '.MONGODB_URI // ""')"
export AWS_REGION="$(echo "$SECRET_JSON" | jq -r --arg fallback "$AWS_REGION" '.AWS_REGION // $fallback')"
export AWS_S3_BUCKET="$(echo "$SECRET_JSON" | jq -r '.AWS_S3_BUCKET // ""')"
export JWT_SECRET="$(echo "$SECRET_JSON" | jq -r '.JWT_SECRET // ""')"
export JWT_EXPIRES_IN="$(echo "$SECRET_JSON" | jq -r '.JWT_EXPIRES_IN // "7d"')"
export GOOGLE_CLIENT_ID="$(echo "$SECRET_JSON" | jq -r '.GOOGLE_CLIENT_ID // ""')"
export VITE_GOOGLE_CLIENT_ID="$(echo "$SECRET_JSON" | jq -r '.VITE_GOOGLE_CLIENT_ID // ""')"
export CLIENT_ORIGIN="$(echo "$SECRET_JSON" | jq -r '.CLIENT_ORIGIN // ""')"
export MAX_UPLOAD_SIZE_MB="$(echo "$SECRET_JSON" | jq -r '.MAX_UPLOAD_SIZE_MB // "500"')"

for required_var in MONGODB_URI AWS_REGION AWS_S3_BUCKET JWT_SECRET GOOGLE_CLIENT_ID VITE_GOOGLE_CLIENT_ID CLIENT_ORIGIN; do
  if [ -z "${!required_var}" ]; then
    echo "Missing required deployment value: $required_var"
    exit 1
  fi
done

rm -f server/.env .env

docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8080/api/v1/tracks >/dev/null; then
    echo "Music Streaming App deployment healthy"
    exit 0
  fi

  echo "Waiting for app health check... ($attempt/30)"
  sleep 3
done

echo "Deployment failed health check"
docker compose -f docker-compose.prod.yml logs --tail=120 server
exit 1
