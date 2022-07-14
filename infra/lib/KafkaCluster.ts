import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as msk from "@aws-cdk/aws-msk-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { IVpc, Vpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import * as cr from "aws-cdk-lib/custom-resources";
import { CustomResource, Stack } from "aws-cdk-lib";
import { Construct, Node } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export const enum MskClusterType {
  /**
   * Default Msk Kafka cluster type
   */
  DEFAULT = "msk",
  /**
   * Serverless Msk Kafka cluster
   */
  SERVERLESS = "msk-serverless",
}
type ClusterType = "msk" | "self-managed" | "msk-serverless";
interface KafkaClusterBaseProps {
  clusterType: ClusterType;
}

export type IKafkaCluster = {
  bootstrapAddress: string;
} & (
  | (KafkaCluster & {
      clusterType: "msk" | "msk-serverless";
    })
  | {
      clusterType: "self-managed";
      secret: ISecret;
    }
);

interface SelfManagedKafkaAttributes {
  bootstrapAddress: string;
  secretArn: string;
}
class KafkaClusterBase extends Construct {
  clusterType: ClusterType;
  bootstrapAddress: string;
  constructor(scope: Construct, id: string, props: KafkaClusterBaseProps) {
    super(scope, id);
    this.clusterType = props.clusterType;
  }
}

interface MskKafkaClusterProps extends KafkaClusterBaseProps {
  clusterName: string;
  clusterType: MskClusterType;
}
type ClusterInfo =
  | {
      clusterType: "msk";
      cluster: msk.Cluster;
    }
  | {
      clusterType: "msk-serverless";
      cluster: CustomResource;
    };
export class KafkaCluster extends KafkaClusterBase {
  info: ClusterInfo;
  clusterType: "msk" | "msk-serverless";
  _clusterBootstrapBrokers: cr.AwsCustomResource;
  vpc: IVpc;
  securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: MskKafkaClusterProps) {
    super(scope, id, {
      ...props,
    });


    this.vpc = Vpc.fromLookup(this, "Vpc", { isDefault: true });
    const securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: this.vpc,
    });
    // console.log({
    //   SubnetIds: this.vpc.publicSubnets.map((subnet) => subnet.subnetId),
    // })
    const parameters = {
      ClusterName: props.clusterName,
      Serverless: JSON.stringify({
        VpcConfigs: [
          {
            SecurityGroupIds: [securityGroup.securityGroupId],
            SubnetIds: this.vpc.publicSubnets.map((subnet) => subnet.subnetId),
          },
        ],
        ClientAuthentication: {
          Sasl: {
            Iam: {
              Enabled: true,
            },
          },
        },
      },)
    };

    const clusterProvider =
      props.clusterType === "msk-serverless"
        ? MskServerlessProvider.getOrCreate(
            this,
            new iam.PolicyStatement({
              actions: ["ec2:*", "kafka:*", "kafka-cluster:*"],
              resources: ["*"],
              effect: iam.Effect.ALLOW,
            })
          )
        : undefined;
    this.info =
      props.clusterType === "msk-serverless"
        ? {
            clusterType: "msk-serverless",
            cluster: new CustomResource(this, "Resource", {
              serviceToken: clusterProvider!!.serviceToken,
              resourceType: "Custom::MskServerless",
              properties: parameters,
            }),
          }
        : {
            clusterType: "msk",
            cluster: new msk.Cluster(this, "Cluster", {
              vpc: this.vpc,
              clusterName: props.clusterName,
              kafkaVersion: msk.KafkaVersion.V2_8_1,
            }),
          };

    this.bootstrapAddress = props.clusterType === "msk-serverless" ? this.bootstrapBrokers("BootstrapBrokerStringSaslIam") : this.bootstrapBrokers("BootstrapBrokerString");
  }

  get clusterArn(): string {
    return this.info.clusterType === "msk"
      ? this.info.cluster.clusterArn
      : this.info.cluster.getAttString("ClusterArn");
  }

  bootstrapBrokers(responseField: string) {
    if (!this._clusterBootstrapBrokers) {
      this._clusterBootstrapBrokers = new cr.AwsCustomResource(this, `BootstrapBrokers${responseField}`, {
        onUpdate: {
          service: "Kafka",
          action: "getBootstrapBrokers",
          parameters: {
            ClusterArn: this.clusterArn,
          },
          physicalResourceId: cr.PhysicalResourceId.of("BootstrapBrokers"),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [this.clusterArn],
        }),
      });
      this._clusterBootstrapBrokers.node.addDependency(this.info.cluster);
    }
    return this._clusterBootstrapBrokers.getResponseField(responseField);
  }

  /**
   * Imports a self-managed kafka cluster by (ssm) secret name & bootstrap servers.
   */
  public static fromSelfManagedAttributes(
    scope: Construct,
    id: string,
    props: SelfManagedKafkaAttributes
  ): IKafkaCluster {
    return new (class extends KafkaClusterBase {
      secret: ISecret;
      clusterType: "self-managed";
      constructor(scope: Construct, id: string) {
        super(scope, id, {
          clusterType: "self-managed",
        });
        this.secret = Secret.fromSecretCompleteArn(scope, id, props.secretArn);
        this.bootstrapAddress = props.bootstrapAddress;
      }
    })(scope, id);
  }
}

class MskServerlessProvider extends Construct {
  private readonly provider: cr.Provider;
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: Construct, policyStatement?: iam.PolicyStatement) {
    const stack = Stack.of(scope);
    const id = "MskServerlessProvider";
    const x = (Node.of(stack).tryFindChild(id) as MskServerlessProvider) || new MskServerlessProvider(stack, id);
    if (policyStatement != null) {
      x.provider.onEventHandler.addToRolePolicy(policyStatement);
      x.provider.isCompleteHandler?.addToRolePolicy(policyStatement);
    }
    return x.provider;
  }

  private constructor(scope: Construct, id: string) {
    super(scope, id);

    // Lambda function to support cloudformation custom resource to create kafka topics.
    const mskServerlessHandler = new NodejsFunction(this, "MskServerlessHandler", {
      functionName: "MskServerlessHandler",
      entry: "../lambdas/MskServerlessProviderLambda/msk-serverless-handler.ts",
      depsLockFilePath: "../lambdas/MskServerlessProviderLambda/package-lock.json",
      handler: "onEvent",
      runtime: lambda.Runtime.NODEJS_14_X,
      // vpc: vpcStack.vpc,
      // securityGroups: [vpcStack.lambdaSecurityGroup],
      timeout: cdk.Duration.minutes(5),
    });

    mskServerlessHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["kafka:*"],
        resources: ["*"],
      })
    );

    this.provider = new cr.Provider(this, "msk-serverless-provider", {
      onEventHandler: mskServerlessHandler,
    });
  }
}
