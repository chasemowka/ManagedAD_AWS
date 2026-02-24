// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Stack, StackProps, CustomResource, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';

export interface QuickSightSubscriptionStackProps extends StackProps {
  readonly stage: string;
  readonly projectPrefix: string;
  readonly notificationEmail: string;
}

export class QuickSightSubscriptionStack extends Stack {
  constructor(scope: Construct, id: string, props: QuickSightSubscriptionStackProps) {
    super(scope, id, props);

    const { stage, projectPrefix, notificationEmail } = props;

    const directoryId = StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/directory-id`);

    const quickSightLambda = new Function(this, 'QuickSightSubscriptionLambda', {
      runtime: Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda/quicksight-handler')),
      timeout: Duration.minutes(10),
      memorySize: 256,
      environment: {
        DIRECTORY_ID: directoryId,
      },
    });

    quickSightLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'ds:AuthorizeApplication',
          'ds:UnauthorizeApplication',
          'ds:CheckAlias',
          'ds:CreateAlias',
          'ds:DescribeDirectories',
          'ds:DescribeTrusts',
          'ds:DeleteDirectory',
          'ds:CreateIdentityPoolDirectory',
          'iam:ListAccountAliases',
          'quicksight:CreateUser',
          'quicksight:DescribeAccountSubscription',
          'quicksight:Subscribe',
          'quicksight:ListUsers',
          'quicksight:ListNamespaces',
          'quicksight:DescribeAccountSettings',
          'quicksight:UpdateAccountSettings',
          'quicksight:CreateAdmin',
          'quicksight:ListGroups',
          'quicksight:CreateGroup',
          'quicksight:DescribeGroup',
          'quicksight:SearchGroups',
          'quicksight:UpdateGroup',
          'quicksight:CreateGroupMembership',
          'quicksight:DescribeGroupMembership',
          'quicksight:ListGroupMemberships',
          'quicksight:DeleteGroupMembership',
          'quicksight:RegisterUser',
          'quicksight:UpdateUser',
          'quicksight:DeleteUser',
          'quicksight:DescribeUser',
          'quicksight:CreateAccountSubscription',
          'quicksight:DeleteAccountSubscription',
        ],
        resources: ['*'],
      }),
    );

    quickSightLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['quicksight:Unsubscribe'],
        resources: ['*'],
      }),
    );

    const quickSightProvider = new Provider(this, 'QuickSightProvider', {
      onEventHandler: quickSightLambda,
    });

    // Group names are configurable via CDK context; default to 'QuickSightAdmins'
    const adminGroup = this.node.tryGetContext('quickSightAdminGroup') ?? 'QuickSightAdmins';
    const authorGroup = this.node.tryGetContext('quickSightAuthorGroup') ?? adminGroup;
    const readerGroup = this.node.tryGetContext('quickSightReaderGroup') ?? adminGroup;

    const quickSightResource = new CustomResource(this, 'QuickSightSubscriptionResource', {
      serviceToken: quickSightProvider.serviceToken,
      properties: {
        AwsAccountId: this.account,
        AccountName: `${projectPrefix}-${this.account}`,
        Edition: 'ENTERPRISE',
        AuthenticationMethod: 'ACTIVE_DIRECTORY',
        ActiveDirectoryName: StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/directory-id`),
        AdminGroup: adminGroup,
        AuthorGroup: authorGroup,
        ReaderGroup: readerGroup,
        NotificationEmail: notificationEmail,
        DirectoryId: directoryId,
      },
    });

    new CfnOutput(this, 'QuickSightSubscriptionStatus', {
      value: quickSightResource.getAttString('Status') || 'Pending',
      description: 'QuickSight subscription status',
    });

    new CfnOutput(this, 'QuickSightAccountId', {
      value: this.account,
      description: 'AWS Account ID used for QuickSight',
    });
  }
}
