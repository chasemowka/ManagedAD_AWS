# Single-Account Deployment Example

Deploy all stacks (dev, gamma, prod) into **one AWS account**, each stage isolated by
its own SSM parameter namespace and resource naming prefix.

## When to use this

- Personal projects or proof-of-concept
- Small teams that don't need account-level isolation
- Fastest path to a working deployment

## Prerequisites

```bash
# Install dependencies
npm install -g aws-cdk
npm install

# Bootstrap CDK in your account (one-time per account/region)
./scripts/bootstrap.sh --account <YOUR_ACCOUNT_ID> --region us-east-1
```

## 1. Configure placeholder values

Edit `examples/single-account/cdk.json` and replace every placeholder:

| Placeholder | Replace with |
|---|---|
| `corp.example.com` | Your AD domain FQDN |
| `CORP` | Your AD NetBIOS short name (≤15 chars, no dots) |
| `admin@example.com` | Email for QuickSight notifications |
| `QuickSightAdmins` | AD group that gets QuickSight Admin role |
| `QuickSightAuthors` | AD group that gets QuickSight Author role |
| `QuickSightReaders` | AD group that gets QuickSight Reader role |

## 2. Deploy

```bash
# Deploy dev stage
cdk deploy --all \
  --context stage=dev \
  --context domainName=corp.example.com \
  --context domainShortName=CORP \
  --context notificationEmail=admin@example.com

# Deploy gamma stage (same account, different prefix)
cdk deploy --all --context stage=gamma ...

# Deploy prod stage
cdk deploy --all --context stage=prod ...
```

Or copy `examples/single-account/cdk.json` to the project root as `cdk.json` and just run:

```bash
cdk deploy --all
```

## 3. Customize AD users and groups

Edit `scripts/setup-ad-v9.ps1`:

```powershell
# Step 7 — add your users
$testUsers = @("Alice", "Bob", "Charlie")

# Step 8 — add your groups (duplicate the block for each group)
New-ADGroup -Name "QuickSight Admins" -SamAccountName "QuickSightAdmins" ...

# Step 9 — assign users to groups
Add-ADGroupMember -Identity "QuickSightAdmins" -Members "Alice" ...
```

## 4. Tear down

```bash
cdk destroy --all --context stage=dev --context domainName=corp.example.com ...
```

> **Cost reminder:** AWS Managed Microsoft AD Standard edition costs ~$100/month.
> Destroy the stack when not in use to avoid charges.
