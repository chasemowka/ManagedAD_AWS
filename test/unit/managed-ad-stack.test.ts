import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ManagedAdStack } from '../../lib/stacks/managed-ad-stack';

const app = new App();
const stack = new ManagedAdStack(app, 'TestManagedAd', {
  stage: 'test',
  domainName: 'corp.example.com',
  domainShortName: 'CORP',
  env: { account: '123456789012', region: 'us-east-1' },
});
const template = Template.fromStack(stack);

test('creates a Managed Microsoft AD directory', () => {
  template.resourceCountIs('AWS::DirectoryService::MicrosoftAD', 1);
});

test('creates a VPC', () => {
  template.resourceCountIs('AWS::EC2::VPC', 1);
});

test('stores directory ID in SSM', () => {
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/draupnir/test/directory-id',
  });
});

test('stores domain admin secret ARN in SSM', () => {
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/draupnir/test/domain-admin-secret-arn',
  });
});

test('creates domain admin secret in Secrets Manager', () => {
  template.resourceCountIs('AWS::SecretsManager::Secret', 2); // admin + user password
});

test('stores subnet IDs in SSM', () => {
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/draupnir/test/subnet-ids',
  });
});
