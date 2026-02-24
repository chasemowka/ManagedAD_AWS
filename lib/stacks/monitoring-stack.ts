// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Alarm, Metric, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

export interface MonitoringStackProps extends StackProps {
  readonly stage: string;
  readonly projectPrefix: string;
}

export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { projectPrefix } = props;
    const metricNamespace = `${projectPrefix}/QuickSight`;

    const healthCheckFunction = new Function(this, 'QuickSightHealthCheck', {
      runtime: Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: Code.fromInline(`
import boto3
import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    account_id = context.invoked_function_arn.split(':')[4]
    namespace = os.environ['METRIC_NAMESPACE']
    logger.info(f"Starting QuickSight health check for account: {account_id}")

    try:
        quicksight = boto3.client('quicksight')
        response = quicksight.describe_account_subscription(AwsAccountId=account_id)
        status = response['AccountInfo']['AccountSubscriptionStatus']
        logger.info(f"QuickSight status: {status}")
        health_value = 1 if status == 'ACCOUNT_CREATED' else 0

        cloudwatch = boto3.client('cloudwatch')
        cloudwatch.put_metric_data(
            Namespace=namespace,
            MetricData=[{'MetricName': 'SubscriptionHealth', 'Value': health_value, 'Unit': 'Count'}]
        )
        return {'statusCode': 200, 'body': json.dumps(f'QuickSight status: {status}')}

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        boto3.client('cloudwatch').put_metric_data(
            Namespace=namespace,
            MetricData=[{'MetricName': 'SubscriptionHealth', 'Value': 0, 'Unit': 'Count'}]
        )
        raise e
      `),
      timeout: Duration.seconds(30),
      environment: {
        METRIC_NAMESPACE: metricNamespace,
      },
    });

    healthCheckFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['quicksight:DescribeAccountSubscription', 'cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );

    new Rule(this, 'HealthCheckSchedule', {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [new LambdaFunction(healthCheckFunction)],
    });

    const healthAlarm = new Alarm(this, 'QuickSightHealthAlarm', {
      metric: new Metric({
        namespace: metricNamespace,
        metricName: 'SubscriptionHealth',
        statistic: 'Average',
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 1,
      treatMissingData: TreatMissingData.BREACHING,
    });

    new AwsCustomResource(this, 'TriggerHealthCheckOnDeploy', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: { FunctionName: healthCheckFunction.functionName, InvocationType: 'Event' },
        physicalResourceId: PhysicalResourceId.of('trigger-health-check'),
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: { FunctionName: healthCheckFunction.functionName, InvocationType: 'Event' },
        physicalResourceId: PhysicalResourceId.of('trigger-health-check'),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [healthCheckFunction.functionArn],
        }),
      ]),
    });

    new CfnOutput(this, 'HealthAlarmName', {
      value: healthAlarm.alarmName,
      exportName: `${props.stage}-QuickSight-HealthAlarm-Name`,
    });
  }
}
