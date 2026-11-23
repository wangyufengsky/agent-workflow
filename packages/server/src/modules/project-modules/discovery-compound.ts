import { createHash } from 'node:crypto';
import {
  type FunctionalTestLaunch,
  type FunctionalTestServicePlan,
  functionalTestServiceInjectionEnvironmentSchema,
  type ProjectJavaModule,
  type ProjectModuleCompound,
} from '@aw/shared';
import { z } from 'zod';
import { visitIdeaXml } from '../functional-tests/index.ts';

const compoundManifest = '.aw/compound-services.json';
const MAX_MEMBERS = 16;
type Scope = ProjectModuleCompound['scope'];
type Reference = { name: string; type: string };
type Declaration = Reference & {
  source: string;
  scope: Scope;
  environmentNames: Set<string>;
  unmanagedEnvironment: boolean;
};
type Compound = Declaration & { members: Reference[]; review: string[] };

export function parseCompoundConfigurations(xml: string, source: string, scope: Scope) {
  const compounds: Compound[] = [];
  const declarations: Declaration[] = [];
  const workspace = source === '.idea/workspace.xml';
  const component = workspace ? 'project/component' : 'component';
  const entry = `${component}/configuration`;
  let owner = false;
  let pending: Compound | undefined;
  let declaration: Declaration | undefined;
  visitIdeaXml(xml, (path, attrs) => {
    if (path === component) {
      owner = attrs.name === (workspace ? 'RunManager' : 'ProjectRunConfigurationManager');
      pending = undefined;
      declaration = undefined;
    }
    if (owner && path === entry) {
      pending = undefined;
      declaration = undefined;
      if (!attrs.name || !attrs.type || attrs.default === 'true') return;
      declaration = {
        name: attrs.name.slice(0, 160),
        type: attrs.type.slice(0, 128),
        source,
        scope,
        environmentNames: new Set(),
        unmanagedEnvironment: false,
      };
      declarations.push(declaration);
      if (attrs.type !== 'CompoundRunConfigurationType') return;
      pending = Object.assign(declaration, { members: [] as Reference[], review: [] as string[] });
      if (attrs['target-name']) pending.review.push('unsupported IDEA execution target');
      compounds.push(pending);
    }
    if (declaration && path === `${entry}/envs/env`) {
      const key = functionalTestServiceInjectionEnvironmentSchema.safeParse(attrs.name);
      if (!key.success || declaration.environmentNames.has(key.data)) declaration.unmanagedEnvironment = true;
      else declaration.environmentNames.add(key.data);
    }
    if (declaration && [`${entry}/envFiles/envFile`, `${entry}/envFilePaths/option`].includes(path))
      declaration.unmanagedEnvironment = true;
    if (pending && path === `${entry}/method/option` && attrs.enabled !== 'false' && attrs.name !== 'Make')
      pending.review.push('unsupported Compound before-launch task');
    if (pending && path === `${entry}/toRun`) {
      if (pending.members.length === MAX_MEMBERS) {
        if (!pending.review.includes('too many Compound members')) pending.review.push('too many Compound members');
        return;
      }
      if (!attrs.name || !attrs.type) pending.review.push('invalid IDEA member reference');
      else pending.members.push({ name: attrs.name.slice(0, 160), type: attrs.type.slice(0, 128) });
      if (attrs['target-name']) pending.review.push('unsupported IDEA member execution target');
    }
  });
  return { compounds, declarations };
}

const memberName = z.string().min(1).max(160);
const metadataSchema = z.strictObject({
  compounds: z
    .array(
      z.strictObject({
        name: memberName,
        target: memberName.optional(),
        services: z
          .array(
            z.strictObject({
              name: memberName,
              dependsOn: z.array(memberName).max(MAX_MEMBERS).default([]),
              inject: z.record(functionalTestServiceInjectionEnvironmentSchema, memberName).default({}),
            }),
          )
          .max(MAX_MEMBERS)
          .default([]),
      }),
    )
    .max(96),
});

type Metadata = z.output<typeof metadataSchema>['compounds'][number];
export function readCompoundMetadata(text: string | undefined, present: boolean, warnings: string[]) {
  if (!present) return undefined;
  try {
    return metadataSchema.parse(JSON.parse(text ?? ''));
  } catch {
    warnings.push(`${compoundManifest}: invalid Compound service metadata`);
    return null;
  }
}

function hasCycle(services: readonly FunctionalTestServicePlan['services'][number][]) {
  const visited = new Set<string>();
  const visit = (id: string, stack = new Set<string>()): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    const next = new Set([...stack, id]);
    if (services.find((service) => service.id === id)?.dependsOn.some((parent) => visit(parent, next))) return true;
    visited.add(id);
    return false;
  };
  return services.some(({ id }) => visit(id));
}

function addMetadata(plan: FunctionalTestServicePlan, meta: Metadata, review: string[]) {
  const services = new Map<string, FunctionalTestServicePlan['services'][number]>();
  for (const service of plan.services) {
    if (!service.name || services.has(service.name)) {
      review.push('service names are ambiguous in Compound metadata');
      return;
    }
    services.set(service.name, service);
  }
  if (meta.target !== undefined) {
    const target = services.get(meta.target);
    if (target) plan.targetServiceId = target.id;
    else review.push('Compound metadata target is not a member');
  }
  const seen = new Set<string>();
  for (const member of meta.services) {
    const service = services.get(member.name);
    if (!service || seen.has(member.name)) {
      review.push(`unknown or duplicate Compound metadata service: ${member.name}`);
      continue;
    }
    seen.add(member.name);
    for (const name of new Set(member.dependsOn)) {
      const dependency = services.get(name);
      if (dependency && dependency !== service) service.dependsOn.push(dependency.id);
      else review.push(`unknown or invalid prerequisite for ${member.name}: ${name}`);
    }
    for (const [env, name] of Object.entries(member.inject)) {
      const source = services.get(name);
      if (!source || !service.dependsOn.includes(source.id))
        review.push(`injection ${env} for ${member.name} requires a declared prerequisite`);
      else service.inject.push({ env, serviceId: source.id });
    }
  }
  if (hasCycle(plan.services)) review.push('cyclic Compound service dependencies');
}

export function discoverCompounds(
  compounds: Compound[],
  declarations: Declaration[],
  modules: ProjectJavaModule[],
  metadata: ReturnType<typeof readCompoundMetadata>,
  compoundCandidates: ReadonlyMap<string, FunctionalTestLaunch>,
): ProjectModuleCompound[] {
  const result: ProjectModuleCompound[] = [];
  for (const compound of compounds) {
    const { name, source, scope } = compound;
    const id = `idea-compound:${scope}:${source}:${name}`;
    if (result.some((entry) => entry.id === id)) continue;
    const review = [...compound.review];
    if (
      compounds.some(
        (other) => other !== compound && other.name === name && other.source === source && other.scope === scope,
      )
    )
      review.push('duplicate Compound declaration');
    if (compound.unmanagedEnvironment || compound.environmentNames.size > 0)
      review.push('unsupported Compound-level environment variables');
    const members: ProjectModuleCompound['members'] = [];
    const services: FunctionalTestServicePlan['services'] = [];
    const fingerprints: string[] = [];
    const requiresEnvironment = new Map<
      string,
      { names: Set<string>; member: ProjectModuleCompound['members'][number] }
    >();
    for (const member of compound.members) {
      const eligible = declarations.filter(
        (record) =>
          record.name === member.name &&
          record.type === member.type &&
          (scope === 'local' || record.scope === 'project'),
      );
      const declaration = eligible.length === 1 ? eligible[0] : undefined;
      if (!declaration) {
        members.push({ ...member, status: eligible.length === 0 ? 'missing' : 'ambiguous' });
        continue;
      }
      const matches = modules.flatMap((module) =>
        module.configurations
          .filter(
            (config) =>
              config.name === member.name && config.source === declaration.source && config.scope === declaration.scope,
          )
          .map((configuration) => ({ module, configuration })),
      );
      const match = matches.length === 1 ? matches[0] : undefined;
      const evidence = { source: declaration.source, scope: declaration.scope };
      const supportedType = ['Application', 'SpringBootApplicationConfigurationType'].includes(declaration.type);
      if (!match || !supportedType) {
        members.push({ ...member, ...evidence, status: matches.length > 1 ? 'ambiguous' : 'unsupported' });
        if (!supportedType) review.push(`unsupported IDEA configuration type for ${member.name}: ${declaration.type}`);
        continue;
      }
      const { module, configuration } = match;
      const keys = { moduleId: module.id, configurationId: configuration.id };
      const item: ProjectModuleCompound['members'][number] = { ...member, ...evidence, ...keys, status: 'unsupported' };
      members.push(item);
      fingerprints.push(configuration.fingerprint);
      const hasDeclaredEnvironment = declaration.environmentNames.size > 0;
      const launch = declaration.unmanagedEnvironment
        ? null
        : (configuration.launch ?? (hasDeclaredEnvironment ? compoundCandidates.get(configuration.id) : undefined));
      if (!launch) {
        if (declaration.unmanagedEnvironment) review.push(`unsupported IDEA environment for ${member.name}`);
        else if (configuration.review.length)
          review.push(`unsupported launch settings for ${member.name}: ${configuration.review.join(', ')}`);
        else review.push(`no HTTP service launch for ${member.name}`);
        continue;
      }
      item.status = 'resolved';
      const serviceId = configuration.id;
      if (services.some((service) => service.id === serviceId)) {
        review.push(`duplicate Compound member: ${member.name}`);
        continue;
      }
      if (hasDeclaredEnvironment)
        requiresEnvironment.set(serviceId, { names: declaration.environmentNames, member: item });
      services.push({ id: serviceId, name: member.name, moduleId: module.id, launch, dependsOn: [], inject: [] });
    }
    if (members.length === 0) review.push('Compound has no service members');
    const targetServiceId = services[0]?.id;
    const plan = targetServiceId === undefined ? null : { services, targetServiceId };
    const entries = metadata?.compounds.filter((item) => item.name === name) ?? [];
    if (
      metadata === null ||
      entries.length > 1 ||
      (entries.length === 1 && compounds.filter((item) => item.name === name).length > 1)
    )
      review.push('invalid Compound service metadata');
    const meta = entries[0];
    if (plan && meta) addMetadata(plan, meta, review);
    for (const service of services) {
      const requirement = requiresEnvironment.get(service.id);
      if (!requirement) continue;
      const providedKeys = new Set(service.inject.map(({ env }) => env));
      if (
        providedKeys.size !== requirement.names.size ||
        [...requirement.names].some((key) => !providedKeys.has(key))
      ) {
        requirement.member.status = 'unsupported';
        review.push(`Compound injection keys must match the IDEA environment for ${requirement.member.name}`);
      }
    }
    if (members.some((member) => member.status !== 'resolved'))
      review.push('unresolved or unsupported Compound members');
    const output = {
      id,
      name,
      source,
      scope,
      ...(meta === undefined ? {} : { metadataSource: compoundManifest }),
      members,
      review: [...new Set(review)],
      plan: review.length ? null : plan,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([output, fingerprints, meta]))
      .digest('hex');
    result.push({ ...output, fingerprint });
  }
  return result;
}

export { compoundManifest };
