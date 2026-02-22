# Architecture

## Overview

Draupnir-MAD-CDK deploys four CDK stacks in sequence. Each stack writes its outputs to SSM Parameter Store so the next stack can read them — no CloudFormation cross-stack references.

```
+---------------------------------------------------------------+
|                        AWS Account                            |
|                                                               |
|  +------------------+     SSM      +----------------------+   |
|  |  ManagedAdStack  | -----------> |  AdAutomationStack   |   |
|  |                  |             |                      |   |
|  |  * VPC           |             |  * Lambda (Node 18)  |   |
|  |  * Managed AD    |             |  * EC2 (Windows)     |   |
|  |  * Secrets Mgr   |             |  * SSM Run Command   |   |
|  |  * SSM Params    |             |  * PowerShell script |   |
|  +------------------+             +----------------------+   |
|           SSM ----------------------------+                   |
|                                           v                   |
|  +---------------------------+   +-------------------------+  |
|  |     MonitoringStack       |   | QuickSightSubscription  |  |
|  |                           | <-|         Stack           |  |
|  |  * Lambda (Python 3.12)   |   |  * Lambda (Node 18)     |  |
|  |  * EventBridge (5 min)    |   |  * Custom Resource      |  |
|  |  * CloudWatch Alarm       |   |  * QuickSight Enterprise|  |
|  +---------------------------+   +-------------------------+  |
+---------------------------------------------------------------+
```

## Stack Details

### ManagedAdStack

Creates the networking and directory foundation.

- **VPC** — 2 public subnets across 2 AZs (no NAT gateway to minimise cost)
- **AWS Managed Microsoft AD** — Standard edition by default; domain name and short name are fully configurable via CDK context
- **Secrets Manager** — auto-generates the AD Admin password and a user password; neither is ever stored in source code
- **SSM Parameter Store** — publishes `directory-id`, `vpc-id`, `subnet-ids`, `dns-ips`, and secret ARNs for downstream stacks

### AdAutomationStack

Automates AD object creation using a short-lived EC2 instance.

- **Lambda orchestrator** — a Node 18 custom resource handler that launches the EC2 instance, waits for SSM registration, runs domain join, then executes the PowerShell setup script
- **EC2 instance** — Windows Server 2022, `m5.large`, terminated after the script completes
- **PowerShell script** (`scripts/setup-ad-v9.ps1`) — creates OUs, users, and groups; fully parameterised, no hardcoded names
- **S3 asset** — the PowerShell script is uploaded as a CDK asset and downloaded to the instance at runtime
- **IAM** — least-privilege roles for both the Lambda and the EC2 instance profile

### QuickSightSubscriptionStack

Creates a QuickSight Enterprise subscription tied to the Managed AD.

- **Lambda custom resource** — handles Create / Update / Delete lifecycle; includes retry logic with exponential backoff for QuickSight eventual consistency
- **AD group mapping** — Admin, Author, and Reader groups are configurable via CDK context (`quickSightAdminGroup`, `quickSightAuthorGroup`, `quickSightReaderGroup`)
- **Idempotent** — checks existing subscription status before attempting creation; handles `UNSUBSCRIBE_FAILED` state gracefully

### MonitoringStack

Provides ongoing health visibility.

- **Health check Lambda** (Python 3.12) — calls `DescribeAccountSubscription` every 5 minutes and publishes a `Draupnir/QuickSight/SubscriptionHealth` metric
- **CloudWatch Alarm** — triggers when health metric drops below 1 for 2 consecutive periods
- **EventBridge rule** — schedules the health check
- **Trigger on deploy** — an `AwsCustomResource` invokes the health check immediately after each deployment

## Data Flow

```
Deploy time:
  cdk deploy
    -> ManagedAdStack writes SSM params
    -> AdAutomationStack reads SSM, runs EC2 automation
    -> QuickSightSubscriptionStack reads SSM, creates subscription
    -> MonitoringStack schedules health checks

Runtime:
  EventBridge (every 5 min)
    -> Health check Lambda
    -> QuickSight DescribeAccountSubscription
    -> CloudWatch PutMetricData
    -> Alarm evaluates metric
```

## Security Model

- All secrets stored in AWS Secrets Manager; never in environment variables or source code
- EC2 instance communicates with AD over the VPC private network
- IAM roles follow least privilege; EC2 role scoped to SSM core + specific S3 bucket
- Lambda roles scoped to the exact QuickSight and Directory Service actions required
- `quicksight:Unsubscribe` is explicitly denied on the QuickSight Lambda role