#!/usr/bin/env bash
# bootstrap.sh — Bootstrap CDK in one or more AWS accounts/regions.
# Works with any AWS account; no Amazon-internal tooling required.
#
# Usage:
#   Single account:
#     ./scripts/bootstrap.sh --account 123456789012 --region us-east-1
#
#   Multiple accounts (comma-separated):
#     ./scripts/bootstrap.sh --accounts "111111111111,222222222222,333333333333" --region us-east-1
#
#   With a named AWS CLI profile:
#     ./scripts/bootstrap.sh --account 123456789012 --region us-east-1 --profile my-profile

set -euo pipefail

ACCOUNTS=""
REGION=""
PROFILE=""

# ── Parse arguments ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --account)  ACCOUNTS="$2";  shift 2 ;;
    --accounts) ACCOUNTS="$2";  shift 2 ;;
    --region)   REGION="$2";    shift 2 ;;
    --profile)  PROFILE="$2";   shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$ACCOUNTS" || -z "$REGION" ]]; then
  echo "Usage: $0 --account <ACCOUNT_ID> --region <REGION> [--profile <AWS_PROFILE>]"
  echo "       $0 --accounts \"ID1,ID2,ID3\" --region <REGION> [--profile <AWS_PROFILE>]"
  exit 1
fi

PROFILE_ARG=""
if [[ -n "$PROFILE" ]]; then
  PROFILE_ARG="--profile $PROFILE"
  export AWS_PROFILE="$PROFILE"
fi

# ── Verify AWS CLI is available ────────────────────────────────────────────────
if ! command -v aws &>/dev/null; then
  echo "ERROR: AWS CLI not found. Install it from https://aws.amazon.com/cli/"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "ERROR: npx not found. Install Node.js 18+ from https://nodejs.org/"
  exit 1
fi

# ── Bootstrap each account ─────────────────────────────────────────────────────
IFS=',' read -ra ACCOUNT_LIST <<< "$ACCOUNTS"

for ACCOUNT in "${ACCOUNT_LIST[@]}"; do
  ACCOUNT=$(echo "$ACCOUNT" | tr -d ' ')
  echo ""
  echo "──────────────────────────────────────────────"
  echo "Bootstrapping account: $ACCOUNT  region: $REGION"
  echo "──────────────────────────────────────────────"

  npx cdk bootstrap \
    "aws://${ACCOUNT}/${REGION}" \
    $PROFILE_ARG

  echo "✓ Bootstrapped $ACCOUNT / $REGION"
done

echo ""
echo "All accounts bootstrapped successfully."
echo "You can now run: cdk deploy --all --context stage=dev ..."
