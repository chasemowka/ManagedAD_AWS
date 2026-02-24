// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Stack, StackProps, Fn, Duration, CfnOutput, RemovalPolicy, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
  PolicyStatement,
  Effect,
  CfnInstanceProfile,
} from 'aws-cdk-lib/aws-iam';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as path from 'path';

export interface AdAutomationStackProps extends StackProps {
  readonly stage: string;
  readonly projectPrefix: string;
  readonly domainName: string;
  readonly domainShortName: string;
}

export class AdAutomationStack extends Stack {
  constructor(scope: Construct, id: string, props: AdAutomationStackProps) {
    super(scope, id, props);

    const { stage, projectPrefix, domainName } = props;

    const directoryId = StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/directory-id`);
    const vpcId = StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/vpc-id`);
    const adminPasswordSecretArn = StringParameter.valueForStringParameter(
      this,
      `/${projectPrefix}/${stage}/domain-admin-secret-arn`,
    );

    const vpc = Vpc.fromVpcAttributes(this, 'ImportedVpc', {
      vpcId,
      availabilityZones: StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/vpc-azs`).split(','),
    });

    const securityGroup = new SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      description: 'Security group for AD automation EC2 instance',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(3389), 'Allow RDP');
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(53), 'Allow DNS TCP');
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.udp(53), 'Allow DNS UDP');

    const keyPairSecret = new Secret(this, 'EC2KeyPairSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ KeyPairName: `${id}-KeyPair` }),
        generateStringKey: 'PrivateKey',
      },
      secretName: `/${projectPrefix}/${stage}/ec2-keypair`,
    });

    const ec2Role = new Role(this, 'EC2Role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    ec2Role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ds:CreateComputer', 'ds:DescribeDirectories', 'ds:JoinDomain'],
        resources: ['*'],
      }),
    );

    ec2Role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [keyPairSecret.secretArn, adminPasswordSecretArn],
      }),
    );

    const instanceProfile = new CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [ec2Role.roleName],
      instanceProfileName: `${id}-EC2InstanceProfile`,
    });

    const scriptsBucket = new Bucket(this, 'ScriptsBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    ec2Role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [scriptsBucket.bucketArn, `${scriptsBucket.bucketArn}/*`],
      }),
    );

    const setupScriptAsset = new Asset(this, 'SetupScript', {
      path: path.join(__dirname, '../../scripts/setup-ad-v9.ps1'),
    });
    setupScriptAsset.grantRead(ec2Role);

    const adSetupLambda = new Function(this, 'AdSetupLambda', {
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda/ad-automation')),
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        PROJECT_PREFIX: projectPrefix,
        DIRECTORY_ID: directoryId,
        ADMIN_SECRET_ARN: adminPasswordSecretArn,
        KEY_PAIR_SECRET_ARN: keyPairSecret.secretArn,
        SCRIPTS_BUCKET: setupScriptAsset.bucket.bucketName,
        SETUP_SCRIPT_KEY: setupScriptAsset.s3ObjectKey,
        DOMAIN_NAME: domainName,
        INSTANCE_PROFILE_NAME: instanceProfile.instanceProfileName ?? `${id}-EC2InstanceProfile`,
        SECURITY_GROUP_ID: securityGroup.securityGroupId,
      },
    });

    scriptsBucket.grantRead(adSetupLambda);
    setupScriptAsset.grantRead(adSetupLambda);

    adSetupLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
        resources: [keyPairSecret.secretArn, adminPasswordSecretArn],
      }),
    );

    adSetupLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [ec2Role.roleArn],
      }),
    );

    adSetupLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ec2:*'],
        resources: ['*'],
      }),
    );

    adSetupLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:*'],
        resources: ['*'],
      }),
    );

    adSetupLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ds:DescribeDirectories', 'ds:CreateComputer'],
        resources: ['*'],
      }),
    );

    const adSetupProvider = new Provider(this, 'AdSetupProvider', {
      onEventHandler: adSetupLambda,
    });

    const adSetupResource = new CustomResource(this, 'AdSetupResource', {
      serviceToken: adSetupProvider.serviceToken,
      properties: {
        DirectoryId: directoryId,
        SecurityGroupId: securityGroup.securityGroupId,
        SubnetId: Fn.select(
          0,
          Fn.split(',', StringParameter.valueForStringParameter(this, `/${projectPrefix}/${stage}/subnet-ids`)),
        ),
        InstanceType: 'm5.large',
        KeyPairSecretArn: keyPairSecret.secretArn,
        AdminSecretArn: adminPasswordSecretArn,
      },
    });

    new CfnOutput(this, 'InstanceId', {
      value: adSetupResource.getAttString('InstanceId'),
      description: 'EC2 instance used for AD automation',
    });

    new CfnOutput(this, 'KeyPairSecretArn', {
      value: keyPairSecret.secretArn,
      description: 'ARN of the secret containing the EC2 key pair',
    });
  }
}
