import { writeFileSync } from 'node:fs';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const att = (id, attr) => ({ 'Fn::GetAtt': [id, attr] });
const context = (why, must = []) => ({ 'com.aws.cloudformation.Context': { why, must } });
const resource = (Type, Properties, why, must = []) => ({ Type, Metadata: context(why, must), Properties });
const base = description => ({ AWSTemplateFormatVersion: '2010-09-09', Description: description,
  Metadata: { AWSToolsMetrics: { AWSAgentToolkit: 'aws-cloudformation@3' }, ...context('Seven-day MVP; existing RDS remains outside stack ownership.', ['No NAT, no public database, no RDS replacement.']) }, Resources: {}, Outputs: {} });
const bucket = why => ({ ...resource('AWS::S3::Bucket', {
  PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
  BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
  OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
}, why, ['Private HTTPS access only; retain until explicit cleanup approval.']), DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
const tlsDeny = id => ({ Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [att(id, 'Arn'), sub('${' + id + '.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } });
const output = (Value, Description) => ({ Value, Description });

const foundation = base('Paper Plane deployment artifacts and database secret; retained separately from disposable web infrastructure.');
foundation.Resources.Artifacts = bucket('Immutable Lambda ZIPs; no user or database data.');
foundation.Resources.Artifacts.Properties.LifecycleConfiguration = { Rules: [{ Id: 'ExpireBuilds', Status: 'Enabled', ExpirationInDays: 14, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] };
foundation.Resources.ArtifactsPolicy = resource('AWS::S3::BucketPolicy', { Bucket: ref('Artifacts'), PolicyDocument: { Version: '2012-10-17', Statement: [tlsDeny('Artifacts')] } }, 'Reject plaintext transport.');
foundation.Resources.DatabaseSecret = { ...resource('AWS::SecretsManager::Secret', { Description: 'Paper Plane database URL; populated securely before application stack deployment.' }, 'Deploy-time reference avoids runtime Secrets Manager network access.', ['Never output or commit SecretString.']), DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' };
foundation.Outputs.ArtifactBucket = output(ref('Artifacts'), 'Private deployment artifact bucket');
foundation.Outputs.DatabaseSecretArn = output(ref('DatabaseSecret'), 'Secret identifier only, never its value');

const app = base('Paper Plane weekly MVP: private S3 and CloudFront, HTTP API, Node24 Lambda connected to existing private RDS; no NAT.');
app.Parameters = {
  VpcId: { Type: 'AWS::EC2::VPC::Id' }, SubnetIds: { Type: 'List<AWS::EC2::Subnet::Id>' },
  DatabaseSecurityGroup: { Type: 'AWS::EC2::SecurityGroup::Id' },
  ArtifactBucket: { Type: 'String' }, ApiKey: { Type: 'String' }, MigrationKey: { Type: 'String' },
  DatabaseSecretArn: { Type: 'String', AllowedPattern: 'arn:aws:secretsmanager:.*' },
};
const R = app.Resources;
R.FunctionSecurityGroup = resource('AWS::EC2::SecurityGroup', { GroupDescription: 'Paper Plane functions: only PostgreSQL egress', VpcId: ref('VpcId'), SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, DestinationSecurityGroupId: ref('DatabaseSecurityGroup') }] }, 'API and migration runner share ENIs and private database access.', ['No internet ingress or NAT.']);
R.DatabaseIngress = resource('AWS::EC2::SecurityGroupIngress', { GroupId: ref('DatabaseSecurityGroup'), IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: ref('FunctionSecurityGroup'), Description: 'Paper Plane experiment functions only' }, 'Add one scoped rule; leave existing database and rules intact.', ['Source must be the application security group, never a public CIDR.']);
for (const name of ['Api', 'Migration']) {
  R[`${name}Logs`] = resource('AWS::Logs::LogGroup', { LogGroupName: sub(`/aws/lambda/\${AWS::StackName}-${name.toLowerCase()}`), RetentionInDays: 7 }, 'Short retention limits experiment log charges.');
  R[`${name}Role`] = resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
    Policies: [{ PolicyName: 'Runtime', PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: att(`${name}Logs`, 'Arn') },
      { Effect: 'Allow', Action: ['ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DescribeSubnets', 'ec2:DeleteNetworkInterface', 'ec2:AssignPrivateIpAddresses', 'ec2:UnassignPrivateIpAddresses'], Resource: '*' },
      { Effect: 'Deny', Action: ['ec2:CreateNetworkInterface', 'ec2:DeleteNetworkInterface', 'ec2:AssignPrivateIpAddresses', 'ec2:UnassignPrivateIpAddresses'], Resource: '*', Condition: { ArnEquals: { 'lambda:SourceFunctionArn': sub(`arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:function:\${AWS::StackName}-${name.toLowerCase()}`) } } },
    ] } }],
  }, 'Dedicated runtime role; ENI wildcard is required by Lambda VPC integration.', ['No global IAM policy changes; function code cannot manage ENIs; no runtime secret read.']);
  R[`${name}Function`] = resource('AWS::Lambda::Function', {
    FunctionName: sub(`\${AWS::StackName}-${name.toLowerCase()}`), Runtime: 'nodejs24.x', Architectures: ['x86_64'], Handler: 'index.handler',
    MemorySize: 512, Timeout: name === 'Api' ? 15 : 120,
    Role: att(`${name}Role`, 'Arn'), Code: { S3Bucket: ref('ArtifactBucket'), S3Key: ref(name === 'Api' ? 'ApiKey' : 'MigrationKey') },
    VpcConfig: { SubnetIds: ref('SubnetIds'), SecurityGroupIds: [ref('FunctionSecurityGroup')] },
    Environment: { Variables: { DATABASE_URL: sub('{{resolve:secretsmanager:${DatabaseSecretArn}:SecretString:DATABASE_URL}}'), DATABASE_SSL: 'verify-full', DATABASE_CA_FILE: '/var/runtime/ca-cert.pem', DATABASE_POOL_MAX: '1', NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem', API_RATE_LIMIT: '120', NODE_ENV: 'production' } },
  }, name === 'Api' ? 'Reuse tested Linux ZIP with cached NestJS startup.' : 'Manually invoked migration inspection; no public route or automatic migration.', ['Verified database TLS; migrations never run on API startup.']);
  R[`${name}Function`].DependsOn = ['DatabaseIngress', `${name}Logs`];
}
R.HttpApi = resource('AWS::ApiGatewayV2::Api', { Name: sub('${AWS::StackName}-http'), ProtocolType: 'HTTP' }, 'Low fixed cost and throttling, matching existing payload 2.0 handler.');
R.ApiIntegration = resource('AWS::ApiGatewayV2::Integration', { ApiId: ref('HttpApi'), IntegrationType: 'AWS_PROXY', IntegrationUri: att('ApiFunction', 'Arn'), PayloadFormatVersion: '2.0', TimeoutInMillis: 20000 }, 'Forward requests to NestJS unchanged after edge path rewrite.');
R.ApiRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('HttpApi'), RouteKey: '$default', Target: { 'Fn::Join': ['/', ['integrations', ref('ApiIntegration')]] } }, 'Nest handles route validation.');
R.ApiStage = resource('AWS::ApiGatewayV2::Stage', { ApiId: ref('HttpApi'), StageName: '$default', AutoDeploy: true, DefaultRouteSettings: { ThrottlingBurstLimit: 5, ThrottlingRateLimit: 2 } }, 'Protect five-concurrency account and small database; throttle is best effort.');
R.ApiPermission = resource('AWS::Lambda::Permission', { FunctionName: ref('ApiFunction'), Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceAccount: ref('AWS::AccountId'), SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*') }, 'Only this API may invoke the public application handler.');
R.WebBucket = bucket('Static compiled assets only; no website endpoint or public ACL.');
R.Oac = resource('AWS::CloudFront::OriginAccessControl', { OriginAccessControlConfig: { Name: sub('${AWS::StackName}-s3'), OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' } }, 'CloudFront signs access to private S3.');
R.Rewrite = resource('AWS::CloudFront::Function', {
  Name: sub('${AWS::StackName}-paths'), AutoPublish: true,
  FunctionConfig: { Comment: 'Strip API prefix and route extensionless SPA paths', Runtime: 'cloudfront-js-2.0' },
  FunctionCode: "function handler(event) { var r = event.request; if (r.uri === '/api' || r.uri.indexOf('/api/') === 0) { r.uri = r.uri.substring(4) || '/'; } else if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
}, 'Preserve same origin API calls; SPA fallback must not mask API errors.');
const association = [{ EventType: 'viewer-request', FunctionARN: att('Rewrite', 'FunctionMetadata.FunctionARN') }];
const apiBehavior = { TargetOriginId: 'api', ViewerProtocolPolicy: 'https-only', AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'], CachedMethods: ['GET', 'HEAD'], CachePolicyId: '413f160d-6f9a-4c91-8a7c-450c6f680116', OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', FunctionAssociations: association, Compress: true };
R.Distribution = resource('AWS::CloudFront::Distribution', { DistributionConfig: {
  Enabled: true, Comment: 'Paper Plane seven-day MVP', DefaultRootObject: 'index.html', PriceClass: 'PriceClass_100', HttpVersion: 'http2', IPV6Enabled: true,
  ViewerCertificate: { CloudFrontDefaultCertificate: true },
  Origins: [
    { Id: 'web', DomainName: att('WebBucket', 'RegionalDomainName'), OriginAccessControlId: ref('Oac'), S3OriginConfig: { OriginAccessIdentity: '' } },
    { Id: 'api', DomainName: sub('${HttpApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}'), CustomOriginConfig: { OriginProtocolPolicy: 'https-only', OriginSSLProtocols: ['TLSv1.2'] } },
  ],
  DefaultCacheBehavior: { TargetOriginId: 'web', ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: ['GET', 'HEAD', 'OPTIONS'], CachedMethods: ['GET', 'HEAD'], Compress: true, CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', FunctionAssociations: association },
  CacheBehaviors: [{ PathPattern: '/api/*', ...apiBehavior }, { PathPattern: '/api', ...apiBehavior }],
} }, 'Single HTTPS hostname avoids CORS, domains and load balancers.', ['API caching disabled; origin Host is generated by CloudFront; private S3 OAC only.']);
R.WebPolicy = resource('AWS::S3::BucketPolicy', { Bucket: ref('WebBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [tlsDeny('WebBucket'), { Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: sub('${WebBucket.Arn}/*'), Condition: { StringEquals: { 'AWS:SourceArn': sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}') } } }] } }, 'Only this distribution reads web objects.');
app.Outputs = {
  Url: output(sub('https://${Distribution.DomainName}'), 'Public HTTPS URL'), DistributionId: output(ref('Distribution'), 'CloudFront distribution'),
  WebBucket: output(ref('WebBucket'), 'Private static bucket'), ApiFunction: output(ref('ApiFunction'), 'API Lambda'), MigrationFunction: output(ref('MigrationFunction'), 'Private migration runner'),
  HttpApiId: output(ref('HttpApi'), 'HTTP API ID'), FunctionSecurityGroup: output(ref('FunctionSecurityGroup'), 'Function security group'),
};
for (const [name, template] of [['foundation', foundation], ['app', app]]) {
  const body = JSON.stringify(template, null, 2) + '\n';
  if (Buffer.byteLength(body) > 51200) throw new Error('Inline template too large');
  writeFileSync(`infra/${name}.json`, body);
  console.log(`${name}: ${Object.keys(template.Resources).length} resources, ${Buffer.byteLength(body)} bytes`);
}
