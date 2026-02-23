# managedAD-aws-cdk

AWS CDK solution for automated deployment of **AWS Managed Microsoft AD** with **Amazon QuickSight Enterprise** integration.

## Features

- AWS Managed Microsoft AD deployment with VPC configuration
- EC2-based Active Directory automation (users, groups, OUs) via PowerShell
- Amazon QuickSight Enterprise subscription with AD authentication
- CloudWatch health monitoring and alarms

## Prerequisites

- Node.js 18+
- AWS CDK v2: `npm install -g aws-cdk`
- AWS account with permissions for: Directory Service, QuickSight, EC2, Lambda, Secrets Manager, SSM, IAM, CloudWatch
- CDK bootstrapped in your target account/region: `cdk bootstrap`

## Quick Start

```bash
npm install
npm run build

cdk deploy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com
```

## Configuration

All values are passed via CDK context — nothing is hardcoded.

| Context Key | Required | Description | Example |
|---|---|---|---|
| `stage` | No | Deployment stage (default: `dev`) | `prod` |
| `domainName` | Yes | AD domain FQDN | `corp.example.com` |
| `domainShortName` | Yes | AD NetBIOS name | `CORP` |
| `notificationEmail` | Yes | QuickSight notification email | `admin@example.com` |
| `enableQuickSight` | No | Deploy QuickSight stack (default: `true`) | `false` |
| `enableMonitoring` | No | Deploy monitoring stack (default: `true`) | `false` |
| `quickSightAdminGroup` | No | AD group for QuickSight admins (default: `QuickSightAdmins`) | `MyAdmins` |
| `quickSightAuthorGroup` | No | AD group for QuickSight authors | `MyAuthors` |
| `quickSightReaderGroup` | No | AD group for QuickSight readers | `MyReaders` |

You can also set defaults in `cdk.json` under the `context` key.

## Architecture

```
ManagedAdStack          → Deploys AWS Managed Microsoft AD + VPC
AdAutomationStack       → EC2 instance joins domain, runs PowerShell to create users/groups
QuickSightSubscriptionStack → Creates QuickSight Enterprise subscription with AD auth
MonitoringStack         → CloudWatch alarms + scheduled health checks
```

Each stack passes values to the next via SSM Parameter Store — no cross-stack references.

## Stacks

| Stack | Description |
|---|---|
| `{stage}-ManagedAd` | VPC, Managed AD, Secrets Manager passwords |
| `{stage}-AdAutomation` | EC2 automation, Lambda orchestrator, PowerShell script |
| `{stage}-QuickSight` | QuickSight Enterprise subscription custom resource |
| `{stage}-Monitoring` | Health check Lambda, CloudWatch alarm |

## Customizing AD Users and Groups

Edit `scripts/setup-ad-v9.ps1` and modify:

- `$testUsers` array (Step 7) — users to create
- Group creation block (Step 8) — groups to create
- Group membership block (Step 9) — which users belong to which groups

## Deployment Options

**GitHub Actions** — see `.github/workflows/` (coming soon)

**Manual:**
```bash
# Deploy all stacks
cdk deploy --all --context stage=prod --context domainName=corp.example.com ...

# Deploy a single stack
cdk deploy prod-ManagedAd --context stage=prod --context domainName=corp.example.com ...
```

**Destroy:**
```bash
cdk destroy --all --context stage=dev --context domainName=corp.example.com ...
```

## Cost Estimate

| Service | Approximate Monthly Cost |
|---|---|
| AWS Managed Microsoft AD (Standard) | ~$100 |
| QuickSight Enterprise | ~$18/user/month |
| EC2 (m5.large, temporary) | ~$0 (terminated after setup) |
| Lambda, SSM, Secrets Manager | Minimal |

## License

Apache 2.0 — see [LICENSE](LICENSE)
