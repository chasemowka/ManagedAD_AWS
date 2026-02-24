import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { QuickSightSubscriptionStack } from '../../lib/stacks/quicksight-subscription-stack';

const app = new App({ context: { quickSightAdminGroup: 'QuickSightAdmins' } });
const stack = new QuickSightSubscriptionStack(app, 'TestQuickSight', {
  stage: 'test',
  projectPrefix: 'managed-ad',
  notificationEmail: 'admin@example.com',
  env: { account: '123456789012', region: 'us-east-1' },
});
const template = Template.fromStack(stack);

test('creates a Lambda function for the custom resource', () => {
  template.resourceCountIs('AWS::Lambda::Function', 2); // handler + provider framework
});

test('creates a custom resource for QuickSight subscription', () => {
  template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
});

test('Lambda has QuickSight permissions', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith([
            'quicksight:CreateAccountSubscription',
          ]),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('Lambda has a deny on Unsubscribe', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'quicksight:Unsubscribe',
          Effect: 'Deny',
        }),
      ]),
    },
  });
});

test('outputs QuickSight account ID', () => {
  template.hasOutput('QuickSightAccountId', {});
});
