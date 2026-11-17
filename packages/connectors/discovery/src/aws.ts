import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, type J } from "./util";

/**
 * Read-only AWS commands whose JSON output the connector understands. On desktop the app runs them
 * with the user's local profile; anywhere else the user runs them and picks the saved output.
 */
export const AWS_COMMANDS: string[][] = [
  ["sts", "get-caller-identity"],
  ["ec2", "describe-vpcs"],
  ["ec2", "describe-subnets"],
  ["ec2", "describe-instances"],
  ["rds", "describe-db-instances"],
  ["lambda", "list-functions"],
  ["elbv2", "describe-load-balancers"],
  ["eks", "list-clusters"],
  ["ecs", "list-clusters"],
  ["s3api", "list-buckets"],
  ["sqs", "list-queues"],
];

const tag = (o: J, key = "Name") => (o.Tags as J[] | undefined)?.find((t) => t.Key === key)?.Value as string | undefined;

/** AWS CLI outputs become a deployment model: account, VPCs, subnets, instances and managed services. */
export function discoverAws(files: ImportInput[], config: { region?: string; environment?: string } = {}): ModelPatch {
  const d = new Draft("aws");
  const env = config.environment || "Production";
  const docs: J[] = [];
  for (const f of files) {
    try {
      docs.push(JSON.parse(f.text));
    } catch {
      d.report.push(`${f.name}: not JSON output from the AWS CLI`);
    }
  }
  const pick = (key: string) => docs.filter((x) => x && x[key] !== undefined);
  const account = String(pick("Account")[0]?.Account ?? "AWS account");
  const region = config.region || "";
  const acct = d.element(`aws:account:${account}`, "c4:DeploymentNode", /^\d+$/.test(account) ? `AWS account ${account}` : account, { properties: { technology: "Amazon Web Services", environment: env, ...(region ? { region } : {}) } });
  const props = (extra: J) => ({ environment: env, provider: "aws", ...(region ? { region } : {}), ...extra });
  const vpcs = new Map<string, ReturnType<Draft["element"]>>();
  const subnets = new Map<string, ReturnType<Draft["element"]>>();
  for (const v of pick("Vpcs").flatMap((x) => x.Vpcs))
    vpcs.set(v.VpcId, d.element(`aws:${v.VpcId}`, "c4:DeploymentNode", tag(v) ?? v.VpcId, { parent: acct.id, properties: props({ technology: "Amazon VPC", awsId: v.VpcId, cidr: v.CidrBlock }) }));
  const inVpc = (vpcId?: string) => (vpcId && vpcs.get(vpcId)) || acct;
  for (const s of pick("Subnets").flatMap((x) => x.Subnets))
    subnets.set(s.SubnetId, d.element(`aws:${s.SubnetId}`, "c4:DeploymentNode", tag(s) ?? s.SubnetId, { parent: inVpc(s.VpcId).id, properties: props({ technology: `Subnet (${s.AvailabilityZone ?? "?"})`, awsId: s.SubnetId, cidr: s.CidrBlock }) }));
  let count = vpcs.size + subnets.size;
  for (const i of pick("Reservations").flatMap((x) => x.Reservations).flatMap((r: J) => r.Instances ?? [])) {
    if (i.State?.Name === "terminated") continue;
    count++;
    d.element(`aws:${i.InstanceId}`, "c4:DeploymentNode", tag(i) ?? i.InstanceId, { parent: (subnets.get(i.SubnetId) ?? inVpc(i.VpcId)).id, properties: props({ technology: `EC2 ${i.InstanceType ?? ""}`.trim(), awsId: i.InstanceId, state: i.State?.Name }) });
  }
  for (const db of pick("DBInstances").flatMap((x) => x.DBInstances)) {
    count++;
    d.element(`aws:rds:${db.DBInstanceIdentifier}`, "c4:InfrastructureNode", db.DBInstanceIdentifier, { parent: inVpc(db.DBSubnetGroup?.VpcId).id, properties: props({ technology: `Amazon RDS ${db.Engine ?? ""}`.trim(), kind: "Database", engine: db.Engine, awsId: db.DBInstanceArn ?? db.DBInstanceIdentifier }) });
  }
  for (const fn of pick("Functions").flatMap((x) => x.Functions)) {
    count++;
    d.element(`aws:lambda:${fn.FunctionName}`, "c4:InfrastructureNode", fn.FunctionName, { parent: inVpc(fn.VpcConfig?.VpcId).id, properties: props({ technology: `AWS Lambda ${fn.Runtime ?? ""}`.trim(), awsId: fn.FunctionArn ?? fn.FunctionName }) });
  }
  for (const lb of pick("LoadBalancers").flatMap((x) => x.LoadBalancers)) {
    count++;
    d.element(`aws:elb:${lb.LoadBalancerName}`, "c4:InfrastructureNode", lb.LoadBalancerName, { parent: inVpc(lb.VpcId).id, properties: props({ technology: `Elastic Load Balancing (${lb.Type ?? "application"})`, dns: lb.DNSName, awsId: lb.LoadBalancerArn ?? lb.LoadBalancerName }) });
  }
  for (const b of pick("Buckets").flatMap((x) => x.Buckets)) {
    count++;
    d.element(`aws:s3:${b.Name}`, "c4:InfrastructureNode", b.Name, { parent: acct.id, properties: props({ technology: "Amazon S3", awsId: `arn:aws:s3:::${b.Name}` }) });
  }
  for (const q of pick("QueueUrls").flatMap((x) => x.QueueUrls)) {
    count++;
    const name = String(q).split("/").pop()!;
    d.element(`aws:sqs:${name}`, "c4:InfrastructureNode", name, { parent: acct.id, properties: props({ technology: "Amazon SQS", kind: "Queue", awsId: String(q) }) });
  }
  for (const c of docs.filter((x) => Array.isArray(x?.clusters)).flatMap((x) => x.clusters as string[])) {
    count++;
    const name = c.split("/").pop()!;
    const eks = !c.startsWith("arn:aws:ecs");
    d.element(`aws:${eks ? "eks" : "ecs"}:${name}`, "c4:DeploymentNode", name, { parent: acct.id, properties: props({ technology: eks ? "Amazon EKS" : "Amazon ECS", awsId: c }) });
  }
  d.view("c4", "c4:deployment", `AWS ${account}${region ? ` (${region})` : ""} – discovered`, () => true);
  if (!docs.length) d.report.push(`Run: ${AWS_COMMANDS.map((c) => `aws ${c.join(" ")}`).join("; ")} and pick the JSON output files.`);
  return d.patch(`AWS: ${count} resource(s) in ${/^\d+$/.test(account) ? `account ${account}` : "the account"}`);
}
