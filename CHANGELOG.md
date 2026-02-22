# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-02-22

### Added
- `ManagedAdStack` — deploys AWS Managed Microsoft AD with VPC, Secrets Manager passwords, and SSM parameter outputs
- `AdAutomationStack` — EC2-based AD automation via Lambda orchestrator and PowerShell script (`setup-ad-v9.ps1`)
- `QuickSightSubscriptionStack` — QuickSight Enterprise subscription custom resource with AD authentication and configurable group mappings
- `MonitoringStack` — CloudWatch health alarm with 5-minute scheduled Lambda health checks
- `scripts/bootstrap.sh` — CDK bootstrap automation for single and multi-account deployments
- GitHub Actions workflows for CI (`test.yml`) and multi-stage deployment (`deploy.yml`) with dev -> gamma -> prod approval gates
- Support for both OIDC and IAM key authentication in GitHub Actions
- Single-account and multi-account deployment examples
- Full documentation: ARCHITECTURE.md, DEPLOYMENT.md, TROUBLESHOOTING.md

### Configuration
- All deployment parameters passed via CDK context — no hardcoded values
- AD domain name, short name, notification email, and QuickSight group names are fully configurable
- `enableQuickSight` and `enableMonitoring` context flags to deploy subsets of the solution