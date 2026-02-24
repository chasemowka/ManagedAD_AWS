// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Environment configuration loaded from CDK context.
 *
 * Pass values at synth/deploy time:
 *   cdk deploy --context stage=dev \
 *              --context domainName=corp.example.com \
 *              --context domainShortName=CORP \
 *              --context notificationEmail=admin@example.com
 */
export interface EnvironmentConfig {
  /** Deployment stage, e.g. "dev", "staging", "prod" */
  readonly stage: string;
  /** Prefix used in SSM paths, resource names, and CloudWatch namespaces (default: "managed-ad") */
  readonly projectPrefix: string;
  /** AD domain FQDN, e.g. "corp.example.com" */
  readonly domainName: string;
  /** AD NetBIOS / short name, e.g. "CORP" */
  readonly domainShortName: string;
  /** Email address for QuickSight notifications */
  readonly notificationEmail: string;
  /** Whether to deploy the QuickSight subscription stack */
  readonly enableQuickSight: boolean;
  /** Whether to deploy the monitoring stack */
  readonly enableMonitoring: boolean;
}

import { Node } from 'constructs';

export function loadConfig(node: Node): EnvironmentConfig {
  const required = (key: string): string => {
    const value = node.tryGetContext(key);
    if (!value) {
      throw new Error(
        `Missing required CDK context key: "${key}". ` +
          `Provide it via cdk.json or --context ${key}=<value>`,
      );
    }
    return value as string;
  };

  return {
    stage: (node.tryGetContext('stage') as string | undefined) ?? 'dev',
    projectPrefix: (node.tryGetContext('projectPrefix') as string | undefined) ?? 'managed-ad',
    domainName: required('domainName'),
    domainShortName: required('domainShortName'),
    notificationEmail: required('notificationEmail'),
    enableQuickSight: ((node.tryGetContext('enableQuickSight') as string | undefined) ?? 'true') === 'true',
    enableMonitoring: ((node.tryGetContext('enableMonitoring') as string | undefined) ?? 'true') === 'true',
  };
}
