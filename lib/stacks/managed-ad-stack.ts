// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Stack, StackProps, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Secret, SecretStringGenerator } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnMicrosoftAD } from 'aws-cdk-lib/aws-directoryservice';

export interface ManagedAdStackProps extends StackProps {
  readonly stage: string;
  readonly domainName: string;
  readonly domainShortName: string;
}

export class ManagedAdStack extends Stack {
  constructor(scope: Construct, id: string, props: ManagedAdStackProps) {
    super(scope, id, props);

    const { stage, domainName, domainShortName } = props;

    const passwordConfig: SecretStringGenerator = {
      includeSpace: false,
      passwordLength: 16,
      requireEachIncludedType: true,
      excludePunctuation: true,
    };

    const domainAdminSecret = new Secret(this, 'DomainAdminSecret', {
      description: 'Active Directory Administrator Account',
      secretName: `/draupnir/${stage}/domain-admin-password`,
      generateSecretString: passwordConfig,
    });

    new StringParameter(this, 'DomainAdminSecretArnParam', {
      parameterName: `/draupnir/${stage}/domain-admin-secret-arn`,
      stringValue: domainAdminSecret.secretArn,
    });

    const vpc = new Vpc(this, 'VPC', {
      vpcName: `${id}-VPC`,
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    new StringParameter(this, 'VpcIdParam', {
      parameterName: `/draupnir/${stage}/vpc-id`,
      stringValue: vpc.vpcId,
    });

    new StringParameter(this, 'VpcAzsParam', {
      parameterName: `/draupnir/${stage}/vpc-azs`,
      stringValue: Fn.join(',', vpc.availabilityZones),
    });

    const subnetIds = vpc.selectSubnets({ subnetType: SubnetType.PUBLIC, onePerAz: true }).subnetIds;

    new StringParameter(this, 'SubnetIdsParam', {
      parameterName: `/draupnir/${stage}/subnet-ids`,
      stringValue: Fn.join(',', subnetIds),
    });

    const managedAd = new CfnMicrosoftAD(this, 'ManagedAD', {
      name: domainName,
      password: domainAdminSecret.secretValue.unsafeUnwrap(),
      edition: 'Standard',
      shortName: domainShortName,
      vpcSettings: {
        vpcId: vpc.vpcId,
        subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PUBLIC, onePerAz: true }).subnetIds,
      },
    });

    new StringParameter(this, 'DirectoryIdParam', {
      parameterName: `/draupnir/${stage}/directory-id`,
      stringValue: managedAd.ref,
    });

    new StringParameter(this, 'DnsIpParam', {
      parameterName: `/draupnir/${stage}/dns-ip`,
      stringValue: Fn.select(0, managedAd.attrDnsIpAddresses),
    });

    new StringParameter(this, 'DnsIpsParam', {
      parameterName: `/draupnir/${stage}/dns-ips`,
      stringValue: Fn.join(',', managedAd.attrDnsIpAddresses),
    });

    const userPasswordSecret = new Secret(this, 'UserPasswordSecret', {
      secretName: `/draupnir/${stage}/user-password`,
    });

    new StringParameter(this, 'UserPasswordSecretArnParam', {
      parameterName: `/draupnir/${stage}/user-password-secret-arn`,
      stringValue: userPasswordSecret.secretArn,
    });
  }
}
