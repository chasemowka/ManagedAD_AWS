# Troubleshooting Guide

## AD Domain Join Failures

### Symptom
The `AdAutomationStack` custom resource times out or the EC2 instance fails to join the domain.

### Causes and Fixes

**SSM agent not registered**
The EC2 instance needs time to boot and register with SSM. The Lambda waits 2 minutes after the instance is running, but in slow regions this may not be enough.
- Check SSM Fleet Manager in the AWS Console to see if the instance appears
- If not, check the EC2 instance system log: EC2 Console -> Instance -> Actions -> Monitor and troubleshoot -> Get system log

**DNS resolution failure**
The EC2 instance must resolve the AD domain via the DNS IPs stored in SSM.
- Verify DNS IPs: `aws ssm get-parameter --name /draupnir/<stage>/dns-ips`
- Verify the security group allows outbound UDP/TCP 53

**Wrong subnet**
The EC2 instance must be in the same VPC as the Managed AD.
```bash
aws ssm get-parameter --name /draupnir/<stage>/subnet-ids
aws ssm get-parameter --name /draupnir/<stage>/vpc-id
```

---

## QuickSight Subscription Errors

### Symptom
`QuickSightSubscriptionStack` fails with `ResourceNotFoundException` or `InternalFailure`.

### Causes and Fixes

**QuickSight not available in region**
QuickSight Enterprise with AD authentication is only available in certain regions (`us-east-1`, `us-west-2`, `eu-west-1`, `ap-southeast-1`, and others).
- Check [QuickSight regional availability](https://docs.aws.amazon.com/quicksight/latest/user/regions.html)

**AD not fully propagated**
Ensure `AdAutomationStack` is in `CREATE_COMPLETE` state before deploying `QuickSightSubscriptionStack`.

**Account name already taken**
QuickSight account names must be globally unique. The default `draupnir-<account-id>` is unique per AWS account.

**UNSUBSCRIBE_FAILED state**
The Lambda handles this automatically. Check CloudWatch Logs for the `QuickSightSubscriptionLambda` function for details.

**ThrottlingException**
If retries are exhausted, wait 10 minutes and redeploy:
```bash
cdk deploy <stage>-QuickSight ...
```

---

## CloudFormation Stack Stuck in UPDATE_IN_PROGRESS

### Symptom
A stack has been in `UPDATE_IN_PROGRESS` for more than 60 minutes.

### Fix
1. Check CloudWatch Logs for the Lambda function
2. Cancel the update if needed:
   ```bash
   aws cloudformation cancel-update-stack --stack-name <stack-name>
   ```

---

## CDK Bootstrap Errors

### Symptom
`cdk deploy` fails with: `This stack uses assets, so the toolkit stack must be deployed to the environment`

### Fix
```bash
./scripts/bootstrap.sh --account <ACCOUNT_ID> --region <REGION>
```

---

## Secrets Manager — Password Retrieval Fails

### Symptom
The PowerShell script exits at Step 2.

### Fix
- Verify the Lambda execution role has `secretsmanager:GetSecretValue` on the secret ARN
- Check the secret exists: `aws secretsmanager describe-secret --secret-id /draupnir/<stage>/domain-admin-password`

---

## GitHub Actions — Credentials Error

### Symptom
`Error: Could not load credentials from any providers`

### Fix
- OIDC: verify `AWS_USE_OIDC` repository variable is `true` and the OIDC provider exists in the target account
- IAM keys: verify secrets are set in the correct GitHub **Environment** (not just repository secrets)

---

## Useful Debug Commands

```bash
# View Lambda logs
aws logs tail /aws/lambda/<stage>-AdAutomation-AdSetupLambda --follow
aws logs tail /aws/lambda/<stage>-QuickSight-QuickSightSubscriptionLambda --follow

# Check all SSM parameters for a stage
aws ssm get-parameters-by-path --path /draupnir/<stage>/ \
  --query 'Parameters[*].{Name:Name,Value:Value}'

# Check EC2 instance state
aws ec2 describe-instances \
  --filters 'Name=tag:Name,Values=AD-Automation-Instance' \
  --query 'Reservations[*].Instances[*].{Id:InstanceId,State:State.Name}'

# Check SSM command history on the instance
aws ssm list-command-invocations \
  --instance-id <INSTANCE_ID> \
  --details \
  --query 'CommandInvocations[*].{Cmd:DocumentName,Status:Status}'
```