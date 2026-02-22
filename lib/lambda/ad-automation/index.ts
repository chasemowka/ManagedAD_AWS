// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeImagesCommand, RunInstancesCommand, TerminateInstancesCommand, waitUntilInstanceRunning, DescribeKeyPairsCommand, CreateKeyPairCommand } from '@aws-sdk/client-ec2';
import { SSMClient, DescribeInstanceInformationCommand, SendCommandCommand, GetCommandInvocationCommand, GetDocumentCommand, CreateDocumentCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ec2 = new EC2Client({});
const ssm = new SSMClient({});
const secretsManager = new SecretsManagerClient({});

interface EventProps {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    DirectoryId: string;
    SecurityGroupId: string;
    SubnetId: string;
    InstanceType: string;
    KeyPairSecretArn: string;
    AdminSecretArn: string;
  };
  PhysicalResourceId?: string;
}

interface Response {
  PhysicalResourceId: string;
  Data?: { InstanceId: string };
}

export const handler = async (event: EventProps): Promise<Response> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    const instanceId = event.PhysicalResourceId;
    if (instanceId?.startsWith('i-')) {
      console.log(`Terminating EC2 instance: ${instanceId}`);
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    }
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'deleted' };
  }

  const { DirectoryId, SecurityGroupId, SubnetId, InstanceType, KeyPairSecretArn } = event.ResourceProperties;
  const domainName = process.env.DOMAIN_NAME ?? '';
  const dnsIps: string[] = JSON.parse(process.env.DNS_IPS ?? '[]');

  const keyPairInfo = await getOrCreateKeyPair(KeyPairSecretArn);
  const instanceId = await launchEC2Instance({ subnetId: SubnetId, securityGroupId: SecurityGroupId, instanceType: InstanceType, keyName: keyPairInfo.keyName });

  console.log(`Launched EC2 instance: ${instanceId}`);
  await waitForInstance(instanceId);
  await joinDomain(instanceId, DirectoryId, domainName, dnsIps);

  return { PhysicalResourceId: instanceId, Data: { InstanceId: instanceId } };
};

async function getOrCreateKeyPair(secretArn: string): Promise<{ keyName: string; privateKey: string }> {
  try {
    const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const data = JSON.parse(secret.SecretString ?? '{}');
    await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [data.KeyPairName] }));
    return { keyName: data.KeyPairName, privateKey: data.PrivateKey };
  } catch {
    const keyName = `ad-automation-key-${Date.now()}`;
    const kp = await ec2.send(new CreateKeyPairCommand({ KeyName: keyName }));
    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: secretArn,
        SecretString: JSON.stringify({ KeyPairName: keyName, PrivateKey: kp.KeyMaterial }),
      }),
    );
    return { keyName, privateKey: kp.KeyMaterial ?? '' };
  }
}

async function launchEC2Instance(params: { subnetId: string; securityGroupId: string; instanceType: string; keyName: string }): Promise<string> {
  const images = await ec2.send(
    new DescribeImagesCommand({
      Filters: [
        { Name: 'name', Values: ['Windows_Server-2022-English-Full-Base-*'] },
        { Name: 'state', Values: ['available'] },
      ],
      Owners: ['amazon'],
    }),
  );

  const amiId = images.Images?.sort((a, b) => (b.CreationDate ?? '').localeCompare(a.CreationDate ?? ''))[0]?.ImageId;
  if (!amiId) throw new Error('No Windows AMI found');

  const result = await ec2.send(
    new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: params.instanceType as 'm5.large',
      MinCount: 1,
      MaxCount: 1,
      KeyName: params.keyName,
      SubnetId: params.subnetId,
      SecurityGroupIds: [params.securityGroupId],
      IamInstanceProfile: { Name: process.env.INSTANCE_PROFILE_NAME ?? '' },
      TagSpecifications: [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: 'AD-Automation-Instance' }] }],
      BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 80, VolumeType: 'gp3' } }],
    }),
  );

  return result.Instances?.[0]?.InstanceId ?? '';
}

async function waitForInstance(instanceId: string): Promise<void> {
  console.log(`Waiting for instance ${instanceId} to be running...`);
  await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 600 }, { InstanceIds: [instanceId] });
  console.log('Instance running, waiting 2 minutes for initialization...');
  await new Promise((r) => setTimeout(r, 120_000));
}

async function joinDomain(instanceId: string, directoryId: string, domainName: string, dnsIps: string[]): Promise<void> {
  // Wait for SSM registration
  const info = await ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [instanceId] }] }));
  if (!info.InstanceInformationList?.length) {
    console.log('Instance not yet in SSM, waiting 2 minutes...');
    await new Promise((r) => setTimeout(r, 120_000));
  }

  const dnsIpAddresses = dnsIps.length === 1 && dnsIps[0].includes(',') ? dnsIps[0].split(',') : dnsIps;

  // Ensure domain join document exists
  const docName = 'AWS-JoinDirectoryServiceDomain';
  let useDoc = docName;
  try {
    await ssm.send(new GetDocumentCommand({ Name: docName }));
  } catch {
    const customDoc = 'DraupnirMAD-JoinDirectoryServiceDomain';
    try {
      await ssm.send(new GetDocumentCommand({ Name: customDoc }));
    } catch {
      await ssm.send(
        new CreateDocumentCommand({
          Name: customDoc,
          DocumentType: 'Command',
          DocumentFormat: 'JSON',
          Content: JSON.stringify({
            schemaVersion: '1.2',
            description: 'Join instances to an AWS Directory Service domain.',
            parameters: {
              directoryId: { type: 'String' },
              directoryName: { type: 'String' },
              directoryOU: { type: 'String', default: '' },
              dnsIpAddresses: { type: 'StringList', default: [] },
            },
            runtimeConfig: {
              'aws:domainJoin': {
                properties: {
                  directoryId: '{{ directoryId }}',
                  directoryName: '{{ directoryName }}',
                  directoryOU: '{{ directoryOU }}',
                  dnsIpAddresses: '{{ dnsIpAddresses }}',
                },
              },
            },
          }),
        }),
      );
    }
    useDoc = customDoc;
  }

  const joinCmd = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: useDoc,
      Parameters: { directoryId: [directoryId], directoryName: [domainName], dnsIpAddresses },
      TimeoutSeconds: 900,
    }),
  );
  await waitForCommand(instanceId, joinCmd.Command?.CommandId ?? '');

  // Download and run AD setup script
  const adminPassword = await getAdminPassword();
  const runCmd = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunPowerShellScript',
      Parameters: {
        commands: [
          `Read-S3Object -BucketName "${process.env.SCRIPTS_BUCKET}" -Key "${process.env.SETUP_SCRIPT_KEY}" -File "C:\\setup-ad-v9.ps1"`,
          `powershell.exe -ExecutionPolicy Bypass -File "C:\\setup-ad-v9.ps1" -DomainName "${domainName}" -AdminPassword "${adminPassword}" -Region "${process.env.AWS_REGION ?? 'us-east-1'}"`,
        ],
        executionTimeout: ['3600'],
      },
      TimeoutSeconds: 3600,
    }),
  );
  await waitForCommand(instanceId, runCmd.Command?.CommandId ?? '');
}

async function getAdminPassword(): Promise<string> {
  const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: process.env.ADMIN_SECRET_ARN ?? '' }));
  return secret.SecretString ?? '';
}

async function waitForCommand(instanceId: string, commandId: string): Promise<void> {
  if (!commandId) return;
  await new Promise((r) => setTimeout(r, 30_000));
  for (let i = 0; i < 90; i++) {
    try {
      const result = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }));
      const status = result.Status ?? '';
      console.log(`Command ${commandId} status: ${status}`);
      if (['Success', 'Failed', 'Cancelled'].includes(status)) return;
    } catch (e) {
      console.warn('Error checking command status:', e);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
