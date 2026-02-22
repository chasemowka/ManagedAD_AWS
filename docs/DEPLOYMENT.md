# Deployment Guide

## Prerequisites

- Node.js 18+
- AWS CLI configured: `aws configure`
- AWS CDK v2: `npm install -g aws-cdk`
- AWS account with permissions for: DirectoryService, QuickSight, EC2, Lambda, SecretsManager, SSM, IAM, CloudWatch, S3

## 1. Install and Build

```bash
git clone https://github.com/<your-org>/draupnir-mad-cdk.git
cd draupnir-mad-cdk
npm install
npm run build
```

## 2. Bootstrap CDK

Run once per AWS account/region before the first deploy:

```bash
# Single account
./scripts/bootstrap.sh --account <YOUR_ACCOUNT_ID> --region us-east-1

# Multiple accounts (one per stage)
./scripts/bootstrap.sh \
  --accounts "<DEV_ACCOUNT>,<GAMMA_ACCOUNT>,<PROD_ACCOUNT>" \
  --region us-east-1
```

Or manually:

```bash
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

## 3. Deploy

### Option A — Manual CDK deploy

```bash
cdk deploy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com
```

Deploy a single stack:

```bash
cdk deploy dev-ManagedAd \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com
```

Skip QuickSight or monitoring:

```bash
cdk deploy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com \
  --context enableQuickSight=false \
  --context enableMonitoring=false
```

### Option B — GitHub Actions

See [examples/multi-account/README.md](../examples/multi-account/README.md) for full GitHub Actions setup including secrets configuration and OIDC role creation.

Summary:
1. Create GitHub Environments: `dev`, `gamma`, `prod` (Settings -> Environments)
2. Add required reviewers to `gamma` and `prod` for approval gates
3. Add secrets to each environment (`AWS_DEPLOY_ROLE_ARN` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)
4. Add repository secrets: `DOMAIN_NAME`, `DOMAIN_SHORT_NAME`, `NOTIFICATION_EMAIL`
5. Push to `main` — the workflow runs automatically: dev -> (approval) -> gamma -> (approval) -> prod

## 4. Verify Deployment

```bash
# Check stacks are deployed
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?starts_with(StackName, `dev-`)].StackName'

# Check Managed AD status
aws ds describe-directories \
  --query 'DirectoryDescriptions[*].{Id:DirectoryId,Name:Name,Status:Stage}'

# Check QuickSight subscription
aws quicksight describe-account-subscription \
  --aws-account-id $(aws sts get-caller-identity --query Account --output text)

# Check health alarm
aws cloudwatch describe-alarms \
  --alarm-name-prefix dev-Monitoring
```

## 5. Destroy

```bash
cdk destroy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com
```

> **Note:** QuickSight subscriptions cannot be deleted via API. The delete handler intentionally skips deletion to prevent stack failures. Cancel the QuickSight subscription manually in the AWS Console if needed.

## Deployment Order

Stacks must deploy in this order (handled automatically by `cdk deploy --all`):

```
ManagedAdStack -> AdAutomationStack -> QuickSightSubscriptionStack -> MonitoringStack
```

## Estimated Deployment Time

| Stack | Time |
|---|---|
| ManagedAdStack | ~20 min (AD provisioning) |
| AdAutomationStack | ~15 min (EC2 boot + domain join + script) |
| QuickSightSubscriptionStack | ~5 min |
| MonitoringStack | ~2 min |
| **Total** | **~40 min** |