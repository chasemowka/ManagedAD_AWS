# Multi-Account Deployment Example

Deploy each stage into its **own AWS account** for full isolation.

```
dev account   (123456789010)  →  dev-ManagedAd, dev-AdAutomation, dev-QuickSight, dev-Monitoring
gamma account (123456789011)  →  gamma-*
prod account  (123456789012)  →  prod-*
```

## When to use this

- Teams that need environment isolation (recommended for production workloads)
- Organizations using AWS Organizations / Control Tower
- When you want separate billing per stage

## Prerequisites

You need AWS credentials (or IAM roles) for each account.

```bash
npm install -g aws-cdk
npm install

# Bootstrap CDK in every account/region (one-time)
./scripts/bootstrap.sh \
  --accounts "123456789010,123456789011,123456789012" \
  --region us-east-1
```

## 1. Configure AWS CLI profiles (one per account)

Add to `~/.aws/config`:

```ini
[profile draupnir-dev]
aws_access_key_id     = <DEV_ACCESS_KEY>
aws_secret_access_key = <DEV_SECRET_KEY>
region                = us-east-1

[profile draupnir-gamma]
aws_access_key_id     = <GAMMA_ACCESS_KEY>
aws_secret_access_key = <GAMMA_SECRET_KEY>
region                = us-east-1

[profile draupnir-prod]
aws_access_key_id     = <PROD_ACCESS_KEY>
aws_secret_access_key = <PROD_SECRET_KEY>
region                = us-east-1
```

> **Tip:** If you use AWS SSO, replace the key/secret with `sso_*` fields.
> See [AWS SSO config docs](https://docs.aws.amazon.com/cli/latest/userguide/sso-configure-profile-token.html).

## 2. Deploy per account

```bash
# Dev
AWS_PROFILE=draupnir-dev cdk deploy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com

# Gamma (after validating dev)
AWS_PROFILE=draupnir-gamma cdk deploy --all \
  --context stage=gamma \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com

# Prod
AWS_PROFILE=draupnir-prod cdk deploy --all \
  --context stage=prod \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com
```

## 3. GitHub Actions multi-account setup

In your GitHub repo go to **Settings → Environments** and create three environments:
`dev`, `gamma`, `prod`.

Add these secrets to **each environment** (values differ per account):

| Secret | Description |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | OIDC role ARN **or** leave blank if using IAM keys |
| `AWS_ACCESS_KEY_ID` | IAM key for this account (if not using OIDC) |
| `AWS_SECRET_ACCESS_KEY` | IAM secret for this account (if not using OIDC) |
| `AWS_REGION` | e.g. `us-east-1` |

Add these secrets at the **repository level** (shared across all environments):

| Secret | Description |
|---|---|
| `DOMAIN_NAME` | e.g. `corp.example.com` |
| `DOMAIN_SHORT_NAME` | e.g. `CORP` |
| `NOTIFICATION_EMAIL` | e.g. `admin@example.com` |

Add this **repository variable** to choose auth method:

| Variable | Value |
|---|---|
| `AWS_USE_OIDC` | `true` (OIDC) or leave unset (IAM keys) |

### Setting up OIDC (recommended — no long-lived keys)

In each AWS account, create an IAM OIDC provider and role:

```bash
# Run once per account — replace placeholders
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<YOUR_GITHUB_ORG>/<YOUR_REPO>:*" }
      }
    }]
  }'

aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

Set `AWS_DEPLOY_ROLE_ARN` to `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsDeployRole` in each GitHub environment.

## 4. Customize AD users and groups

Edit `scripts/setup-ad-v9.ps1` — the same script runs in every account:

```powershell
# Step 7 — users to create
$testUsers = @("Alice", "Bob", "Charlie")

# Step 8 — groups to create
New-ADGroup -Name "QuickSight Admins" -SamAccountName "QuickSightAdmins" ...

# Step 9 — group memberships
Add-ADGroupMember -Identity "QuickSightAdmins" -Members "Alice" ...
```

## 5. Tear down

```bash
AWS_PROFILE=draupnir-dev cdk destroy --all --context stage=dev ...
```
