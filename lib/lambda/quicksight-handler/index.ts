// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  QuickSightClient,
  DescribeAccountSubscriptionCommand,
  CreateAccountSubscriptionCommand,
  DeleteAccountSubscriptionCommand,
  UpdateAccountSettingsCommand,
  ListNamespacesCommand,
} from '@aws-sdk/client-quicksight';

interface ResourceProperties {
  DirectoryId: string;
  AwsAccountId: string;
  AccountName: string;
  Edition: string;
  AuthenticationMethod: string;
  ActiveDirectoryName: string;
  Realm?: string;
  AdminGroup: string;
  AuthorGroup?: string;
  ReaderGroup?: string;
  NotificationEmail: string;
}

interface Event {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: ResourceProperties;
  OldResourceProperties?: ResourceProperties;
  PhysicalResourceId?: string;
}

interface Response {
  PhysicalResourceId: string;
  Data?: { Status: string };
}

const client = new QuickSightClient({});

async function withRetry<T>(
  fn: () => Promise<T>,
  name: string,
  maxRetries = 10,
  baseDelay = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const code = (err as { name?: string }).name ?? '';
      const retryable = (err as { $retryable?: { throttling?: boolean } }).$retryable;
      if (!retryable && code !== 'ThrottlingException' && code !== 'InternalFailure') {
        throw err;
      }
      const delay = Math.min(baseDelay * 2 ** attempt, 30000) + (code === 'ThrottlingException' ? 5000 : 0);
      console.log(`[${name}] attempt ${attempt + 1}/${maxRetries} failed (${code}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

async function createSubscription(props: ResourceProperties): Promise<void> {
  const { AwsAccountId, AccountName, Edition, AuthenticationMethod, ActiveDirectoryName, AdminGroup, NotificationEmail } = props;
  const group = AdminGroup;

  console.log('Creating QuickSight subscription...');
  await withRetry(
    () =>
      client.send(
        new CreateAccountSubscriptionCommand({
          AwsAccountId,
          AccountName,
          Edition: Edition as 'ENTERPRISE',
          AuthenticationMethod: AuthenticationMethod as 'ACTIVE_DIRECTORY',
          ActiveDirectoryName,
          AdminGroup: [group],
          AuthorGroup: [group],
          ReaderGroup: [group],
          NotificationEmail,
        }),
      ),
    'createAccountSubscription',
  );
  console.log('QuickSight subscription created successfully');
}

export const handler = async (event: Event): Promise<Response> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties: props } = event;
  const awsAccountId = props.AwsAccountId;

  if (RequestType === 'Delete') {
    console.log(`Skipping deletion of QuickSight subscription for account ${awsAccountId}`);
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'quicksight-subscription' };
  }

  try {
    const response = await withRetry(
      () => client.send(new DescribeAccountSubscriptionCommand({ AwsAccountId: awsAccountId })),
      'describeAccountSubscription',
      5,
    );

    const status = response.AccountInfo?.AccountSubscriptionStatus;
    console.log(`Current subscription status: ${status}`);

    if (status === 'ACCOUNT_CREATED') {
      const nsResponse = await withRetry(
        () => client.send(new ListNamespacesCommand({ AwsAccountId: awsAccountId })),
        'listNamespaces',
        3,
      );
      const capacityRegion = nsResponse.Namespaces?.[0]?.CapacityRegion;
      if (capacityRegion && capacityRegion !== process.env.AWS_REGION) {
        throw new Error(`QuickSight identity region ${capacityRegion} doesn't match ${process.env.AWS_REGION}`);
      }
      return { PhysicalResourceId: `quicksight-subscription-${awsAccountId}`, Data: { Status: 'Existing' } };
    }

    if (status === 'UNSUBSCRIBE_FAILED') {
      await withRetry(
        () =>
          client.send(
            new UpdateAccountSettingsCommand({
              AwsAccountId: awsAccountId,
              DefaultNamespace: 'default',
              NotificationEmail: props.NotificationEmail,
            }),
          ),
        'updateAccountSettings',
      );
      await withRetry(
        () => client.send(new DeleteAccountSubscriptionCommand({ AwsAccountId: awsAccountId })),
        'deleteAccountSubscription',
      );
    }

    await createSubscription(props);
    return { PhysicalResourceId: `quicksight-subscription-${awsAccountId}`, Data: { Status: 'Created' } };
  } catch (err: unknown) {
    const code = (err as { name?: string }).name ?? '';
    if (code === 'ResourceNotFoundException') {
      await createSubscription(props);
      return { PhysicalResourceId: `quicksight-subscription-${awsAccountId}`, Data: { Status: 'Created' } };
    }
    if (code === 'InternalFailure' || code === 'ThrottlingException') {
      console.warn(`Encountered ${code}, returning partial success to avoid stack failure`);
      return { PhysicalResourceId: `quicksight-subscription-${awsAccountId}`, Data: { Status: `PartialFailure-${code}` } };
    }
    throw err;
  }
};
