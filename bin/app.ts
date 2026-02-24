#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { App } from 'aws-cdk-lib';
import { ManagedAdStack } from '../lib/stacks/managed-ad-stack';
import { AdAutomationStack } from '../lib/stacks/ad-automation-stack';
import { QuickSightSubscriptionStack } from '../lib/stacks/quicksight-subscription-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

const app = new App();

// ---------------------------------------------------------------------------
// Configuration — all values come from CDK context (cdk.json or --context)
// or environment variables. Nothing is hardcoded.
//
// Required context keys:
//   stage            - deployment stage name, e.g. "dev"
//   domainName       - AD domain FQDN, e.g. "corp.example.com"
//   domainShortName  - AD NetBIOS name, e.g. "CORP"
//   notificationEmail - email for QuickSight notifications
//
// Optional context keys:
//   enableQuickSight  - "true" | "false"  (default: "true")
//   enableMonitoring  - "true" | "false"  (default: "true")
//
// Environment variables (standard CDK):
//   CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION
// ---------------------------------------------------------------------------

const stage = app.node.tryGetContext('stage') ?? 'dev';
const projectPrefix = app.node.tryGetContext('projectPrefix') ?? 'managed-ad';
const domainName = app.node.tryGetContext('domainName');
const domainShortName = app.node.tryGetContext('domainShortName');
const notificationEmail = app.node.tryGetContext('notificationEmail');
const enableQuickSight = (app.node.tryGetContext('enableQuickSight') ?? 'true') === 'true';
const enableMonitoring = (app.node.tryGetContext('enableMonitoring') ?? 'true') === 'true';

if (!domainName || !domainShortName || !notificationEmail) {
  throw new Error(
    'Missing required CDK context. Provide: domainName, domainShortName, notificationEmail.\n' +
      'Example: cdk deploy --context stage=dev --context domainName=corp.example.com ' +
      '--context domainShortName=CORP --context notificationEmail=admin@example.com',
  );
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const managedAdStack = new ManagedAdStack(app, `${stage}-ManagedAd`, {
  env,
  stage,
  projectPrefix,
  domainName,
  domainShortName,
});

const adAutomationStack = new AdAutomationStack(app, `${stage}-AdAutomation`, {
  env,
  stage,
  projectPrefix,
  domainName,
  domainShortName,
});
adAutomationStack.addDependency(managedAdStack);

if (enableQuickSight) {
  const quickSightStack = new QuickSightSubscriptionStack(app, `${stage}-QuickSight`, {
    env,
    stage,
    projectPrefix,
    notificationEmail,
  });
  quickSightStack.addDependency(adAutomationStack);

  if (enableMonitoring) {
    const monitoringStack = new MonitoringStack(app, `${stage}-Monitoring`, {
      env,
      stage,
      projectPrefix,
    });
    monitoringStack.addDependency(quickSightStack);
  }
}
