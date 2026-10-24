// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BuildConfigSchema } from '../config-schema.js';
import { discoverProjectConfig, parseBuildConfig } from '../config-codec.js';
import { normalizeProjectPath } from '../output-paths.js';
import type { ProjectFiles } from '../types.js';
import { mavenPreviewWrites, type ImportReportItem, type MavenDependency, type MavenImportPreview } from './report.js';
type Xml = Record<string, unknown>;
const object = (value: unknown): Xml =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Xml) : {};
const list = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const children = (node: unknown, group: string, name: string) => list(object(object(node)[group])[name]);
const pluginKey = (node: Xml) => (text(node.groupId) || 'org.apache.maven.plugins') + ':' + text(node.artifactId);
const dependencyKey = (node: Xml) =>
  [text(node.groupId), text(node.artifactId), text(node.type) || 'jar', text(node.classifier)].join(':');
const directory = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
function relative(base: string, path: string): string | undefined {
  if (/^(?:[a-z]+:|\/|\\)/i.test(path) || path.includes('\\') || path.includes('\0')) return undefined;
  const parts = base ? base.split('/') : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return normalizeProjectPath(parts.join('/')) ?? undefined;
}
function merge(a: Xml, b: Xml): Xml {
  const result: Xml = Object.assign(Object.create(null), a);
  for (const [key, value] of Object.entries(b))
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value) ? merge(object(a[key]), object(value)) : value;
  return result;
}
function mergePlugins(a: Xml, b: Xml): Xml {
  const executions = new Map<string, unknown>();
  for (const [index, entry] of [
    ...children(a, 'executions', 'execution'),
    ...children(b, 'executions', 'execution')
  ].entries()) {
    const key = text(object(entry).id) || 'default-' + index;
    executions.set(key, merge(object(executions.get(key)), object(entry)));
  }
  return { ...merge(a, b), executions: { execution: [...executions.values()] } };
}
interface Pom {
  path: string;
  raw: Xml;
  properties: Xml;
  management: Map<string, Xml>;
  plugins: Map<string, Xml>;
  pluginManagement: Map<string, Xml>;
  dependencies: Xml[];
  groupId: string;
  version: string;
}
/** Bounded, static repository inspection: no parent fetching, plugins, environment or executable discovery. */
export function inspectMavenProject(
  files: ProjectFiles,
  input: { pomPath: string; profiles: readonly string[] }
): MavenImportPreview {
  const preview: MavenImportPreview = {
    build: BuildConfigSchema.parse({ schemaVersion: 1 }),
    report: [],
    dependencies: [],
    provenance: { pomPath: input.pomPath, profiles: [...new Set(input.profiles)], documents: [] },
    writes: []
  };
  const seenReports = new Set<string>();
  const report = (
    code: string,
    path: string,
    message: string,
    status: ImportReportItem['status'],
    evidence?: unknown,
    capabilities: string[] = [],
    targets: string[] = []
  ) => {
    const key = JSON.stringify([code, path, message, status, targets, capabilities]);
    if (seenReports.has(key)) return;
    seenReports.add(key);
    preview.report.push({
      code,
      path,
      message,
      status,
      targets,
      capabilities,
      ...(evidence === undefined ? {} : { evidence })
    });
  };
  const configured = discoverProjectConfig(files);
  if (configured.build || configured.diagnostics.length) {
    if (configured.build) {
      const parsed = parseBuildConfig(configured.build);
      if (parsed.value) preview.build = parsed.value;
    }
    report(
      configured.diagnostics.length ? 'MAVEN_CONFIG_AMBIGUOUS' : 'MAVEN_ALREADY_CONFIGURED',
      configured.build?.path ?? input.pomPath,
      configured.diagnostics.length
        ? 'Companion configuration must be repaired before initialization.'
        : 'Existing native build settings remain authoritative.',
      'unresolved',
      configured.diagnostics
    );
    return preview;
  }
  const cache = new Map<string, Pom>();
  const selected = new Set(input.profiles);
  const foundProfiles = new Set<string>();
  let fatal = false;
  let expansionSteps = 0;
  const expand = (value: unknown, properties: Xml, path: string, stack: readonly string[] = []): string => {
    const raw = text(value);
    if (raw.length > 65536 || stack.length > 32 || ++expansionSteps > 10000) {
      report('MAVEN_PROPERTY_UNRESOLVED', path, 'Property expansion exceeds the supported bound.', 'unresolved');
      return raw;
    }
    let size = raw.length;
    return raw.replace(/\$\{([^}]+)\}/g, (whole: string, name: string) => {
      if (stack.includes(name) || !Object.hasOwn(properties, name)) {
        report('MAVEN_PROPERTY_UNRESOLVED', path, 'Property cannot be resolved statically: ' + name, 'unresolved', {
          property: name
        });
        return whole;
      }
      const expanded = expand(properties[name], properties, path, [...stack, name]);
      const nextSize = size + expanded.length - whole.length;
      if (nextSize > 65536) {
        report('MAVEN_PROPERTY_UNRESOLVED', path, 'Expanded property exceeds the supported byte bound.', 'unresolved');
        return whole;
      }
      size = nextSize;
      return expanded;
    });
  };
  const load = (path: string, ancestors: readonly string[] = []): Pom | undefined => {
    if (ancestors.includes(path) || ancestors.length >= 32) {
      report('MAVEN_PARENT_CYCLE', path, 'Local parent cycle or depth limit reached.', 'unresolved');
      return;
    }
    if (cache.has(path)) return cache.get(path);
    const bytes = files.get(path);
    if (bytes === undefined || preview.provenance.documents.length >= 64) {
      report(
        'MAVEN_PARENT_UNRESOLVED',
        path,
        'POM is unavailable within the opened repository or inspection limit.',
        'unresolved'
      );
      return;
    }
    if (bytes.length > 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(bytes)) {
      report('MAVEN_XML_UNSAFE', path, 'POM exceeds the byte limit or declares XML entities/DOCTYPE.', 'unsupported');
      if (!ancestors.length) fatal = true;
      return;
    }
    let raw: Xml;
    try {
      const valid = XMLValidator.validate(bytes);
      if (valid !== true) throw new Error(valid.err.msg);
      const parsed: unknown = new XMLParser({
        removeNSPrefix: true,
        ignoreAttributes: false,
        parseTagValue: false,
        processEntities: false
      }).parse(bytes);
      const value = object(parsed).project;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected one Maven project element.');
      raw = object(value);
    } catch (error) {
      report('MAVEN_XML_INVALID', path, error instanceof Error ? error.message : String(error), 'unsupported');
      if (!ancestors.length) fatal = true;
      return;
    }
    const pending: { value: unknown; depth: number }[] = [{ value: raw, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const entry = pending.pop()!;
      if (++nodes > 50000 || entry.depth > 128) {
        report('MAVEN_XML_UNSAFE', path, 'POM exceeds the supported structure bound.', 'unsupported');
        if (!ancestors.length) fatal = true;
        return;
      }
      if (entry.value && typeof entry.value === 'object')
        for (const child of Object.values(entry.value)) pending.push({ value: child, depth: entry.depth + 1 });
    }
    preview.provenance.documents.push(path);
    const parentNode = object(raw.parent);
    let parent: Pom | undefined;
    if (raw.parent) {
      const parentPath = relative(
        directory(path),
        parentNode.relativePath === undefined ? '../pom.xml' : text(parentNode.relativePath)
      );
      if (
        (text(parentNode.relativePath) === '' && parentNode.relativePath !== undefined) ||
        !parentPath ||
        !files.has(parentPath)
      )
        report(
          'MAVEN_PARENT_UNRESOLVED',
          path + '#parent',
          'External or unavailable parent metadata is not fetched automatically.',
          'unresolved',
          parentNode
        );
      else parent = load(parentPath, [...ancestors, path]);
    }
    const blocks = [raw];
    for (const entry of children(raw, 'profiles', 'profile')) {
      const profile = object(entry),
        id = text(profile.id);
      foundProfiles.add(id);
      if (profile.activation)
        report(
          'MAVEN_PROFILE_ACTIVATION',
          path + '#profiles/' + id,
          'Profile activation requires explicit selection; browser OS/JDK/settings are not inferred.',
          'unresolved',
          profile.activation
        );
      if (selected.has(id)) blocks.push(profile);
    }
    const properties = Object.assign(
      Object.create(null),
      parent?.properties,
      ...blocks.map((block) => object(block.properties))
    ) as Xml;
    const groupId = expand(raw.groupId || parent?.groupId, properties, path + '#groupId');
    const version = expand(raw.version || parent?.version, properties, path + '#version');
    Object.assign(properties, {
      'project.groupId': groupId,
      'project.artifactId': text(raw.artifactId),
      'project.version': version,
      'project.parent.version': parent?.version || text(parentNode.version),
      'project.basedir': directory(path) || '.',
      basedir: directory(path) || '.',
      'project.build.directory': relative(directory(path), text(object(raw.build).directory) || 'target')
    });
    const management = new Map(parent?.management);
    const pluginManagement = new Map(parent?.pluginManagement);
    const plugins = new Map(parent?.plugins);
    const dependencies = new Map((parent?.dependencies ?? []).map((node) => [dependencyKey(node), node]));
    for (const block of blocks) {
      for (const entry of children(object(block.dependencyManagement), 'dependencies', 'dependency')) {
        const node = object(entry);
        management.set(dependencyKey(node), node);
      }
      for (const entry of children(block, 'dependencies', 'dependency')) {
        const node = object(entry);
        dependencies.set(dependencyKey(node), node);
      }
      const build = object(block.build);
      for (const entry of children(object(build.pluginManagement), 'plugins', 'plugin')) {
        const node = object(entry),
          key = pluginKey(node);
        pluginManagement.set(key, mergePlugins(pluginManagement.get(key) ?? {}, node));
      }
      for (const entry of children(build, 'plugins', 'plugin')) {
        const node = object(entry),
          key = pluginKey(node);
        plugins.set(key, mergePlugins(plugins.get(key) ?? pluginManagement.get(key) ?? {}, node));
      }
    }
    const effective = {
      ...raw,
      modules: { module: blocks.flatMap((block) => children(block, 'modules', 'module')) },
      build: {
        ...object(raw.build),
        resources: { resource: blocks.flatMap((block) => children(object(block.build), 'resources', 'resource')) }
      }
    };
    const model: Pom = {
      path,
      raw: effective,
      properties,
      management,
      plugins,
      pluginManagement,
      dependencies: [...dependencies.values()],
      groupId,
      version
    };
    cache.set(path, model);
    return model;
  };
  const rootPath = normalizeProjectPath(input.pomPath);
  const root = rootPath ? load(rootPath) : undefined;
  if (!root) return preview;
  preview.provenance.artifactId = text(root.raw.artifactId);
  const modules = new Map<string, Pom>();
  const visit = (model: Pom) => {
    if (modules.has(model.path)) return;
    modules.set(model.path, model);
    for (const entry of children(model.raw, 'modules', 'module')) {
      const path = relative(directory(model.path), text(entry) + '/pom.xml');
      if (path) {
        const child = load(path);
        if (child) visit(child);
      } else
        report(
          'MAVEN_PATH_UNRESOLVED',
          model.path + '#modules',
          'Module path is outside the repository.',
          'unresolved',
          text(entry)
        );
    }
  };
  visit(root);
  const sources = new Set<string>(),
    resources = new Set<string>(),
    runeConfigs = new Set<string>();
  const portable = (value: unknown, model: Pom, origin: string): string | undefined => {
    const marker = '@rune-workspace-root@/';
    const raw = expand(
      value,
      {
        ...model.properties,
        'project.basedir': marker + directory(model.path),
        basedir: marker + directory(model.path),
        'project.build.directory': marker + text(model.properties['project.build.directory'])
      },
      origin
    );
    const path =
      raw.includes('$' + '{') || text(value).includes(marker)
        ? undefined
        : raw.startsWith(marker)
          ? relative('', raw.slice(marker.length))
          : raw.includes(marker)
            ? undefined
            : relative(directory(model.path), raw);
    if (!path)
      report('MAVEN_PATH_UNRESOLVED', origin, 'Path is unresolved or outside the repository.', 'unresolved', raw);
    return path;
  };
  for (const model of modules.values()) {
    for (const [index, rawDependency] of model.dependencies.entries()) {
      const base = model.management.get(dependencyKey(rawDependency)) ?? {};
      const node = merge(base, rawDependency),
        path = model.path + '#dependencies/' + index;
      const read = (field: string) => expand(node[field], model.properties, path + '/' + field);
      const dependency: MavenDependency = {
        groupId: read('groupId'),
        artifactId: read('artifactId'),
        version: read('version') || undefined,
        type: read('type') || 'jar',
        scope: read('scope') || 'compile',
        ...(read('classifier') ? { classifier: read('classifier') } : {}),
        exclusions: children(node, 'exclusions', 'exclusion').map((entry) => ({
          groupId: text(object(entry).groupId),
          artifactId: text(object(entry).artifactId)
        })),
        path
      };
      preview.dependencies.push(dependency);
      report(
        'MAVEN_DEPENDENCY_UNRESOLVED',
        path,
        'Dependency requires an explicit artifact-to-release or installed implementation mapping.',
        'unresolved',
        dependency,
        ['dependency:' + dependency.groupId + ':' + dependency.artifactId]
      );
    }
    for (const resource of children(object(model.raw.build), 'resources', 'resource')) {
      const node = object(resource),
        path = model.path + '#build/resources';
      const resolved = portable(node.directory, model, path);
      if (resolved) resources.add(resolved);
      if (text(node.filtering) === 'true' || node.includes || node.excludes)
        report(
          'MAVEN_FILTERING',
          path,
          'Resource filtering/includes/excludes require review; only original source bytes are portable.',
          'unsupported',
          node,
          ['maven:resource-filtering']
        );
    }
    for (const [key, plugin] of model.plugins) {
      const path = model.path + '#build/plugins/' + key;
      const version = expand(plugin.version, model.properties, path + '/version');
      const configurations: unknown[] = [
        plugin.configuration,
        ...children(plugin, 'executions', 'execution').map((entry) => object(entry).configuration)
      ];
      while (configurations.length) {
        const config = object(configurations.pop());
        if (text(config.filtering) === 'true')
          report(
            'MAVEN_FILTERING',
            path,
            'Plugin resource filtering requires an explicit native preparation step.',
            'unsupported',
            config,
            ['maven:resource-filtering']
          );
        if (text(config.mainClass))
          report(
            'MAVEN_NATIVE_REQUIREMENT',
            path,
            'A Java class is required by this lifecycle step and is not executed.',
            'unsupported',
            { mainClass: text(config.mainClass) },
            ['java:class:' + text(config.mainClass)]
          );
        for (const value of Object.values(config))
          if (value && typeof value === 'object') configurations.push(...list(value));
      }
      const known =
        ['org.finos.rune:rune-maven-plugin', 'com.regnosys.rosetta:rosetta-maven-plugin'].includes(key) &&
        ['10.10.0', '10.7.0', '9.76.2'].includes(version);
      if (!known) {
        report(
          'MAVEN_PLUGIN_UNSUPPORTED',
          path,
          'Plugin/lifecycle work is not executed by native Studio.',
          'unsupported',
          { ...plugin, version },
          ['maven:plugin:' + key]
        );
        continue;
      }
      for (const [index, execution] of children(plugin, 'executions', 'execution').entries()) {
        const node = object(execution),
          origin = path + '/executions/' + index;
        const goals = children(node, 'goals', 'goal').map(text);
        if (!goals.includes('generate')) {
          report(
            'MAVEN_GOAL_UNSUPPORTED',
            origin,
            'Only generator metadata is understood; goals are never executed.',
            'unsupported',
            node
          );
          continue;
        }
        const config = merge(object(plugin.configuration), object(node.configuration));
        const configPath =
          config.runeConfig || config.rosettaConfig
            ? portable(config.runeConfig || config.rosettaConfig, model, origin)
            : undefined;
        if (configPath && files.has(configPath)) runeConfigs.add(configPath);
        let roots = children(config, 'sourceRoots', 'sourceRoot');
        if (!roots.length) roots = ['src/main/rosetta'];
        for (const value of roots) {
          const resolved = portable(value, model, origin);
          if (!resolved) continue;
          if (resolved.includes('/target/') || resolved.startsWith('target/'))
            report(
              'MAVEN_GENERATED_SOURCE',
              origin,
              'Build-produced inputs are unavailable; the original Rune source remains editable.',
              'unresolved',
              resolved,
              ['maven:generated-source']
            );
          else sources.add(resolved + '/**/*.rosetta');
        }
        // Raw editable sources are distinct from filtered/generated inputs required by the Maven execution.
        const editable = relative(directory(model.path), 'src/main/rosetta');
        if (editable) sources.add(editable + '/**/*.rosetta');
        const languages = children(config, 'languages', 'language');
        for (const [languageIndex, language] of (languages.length
          ? languages
          : [{ setup: 'com.regnosys.rosetta.RosettaStandaloneSetup' }]
        ).entries()) {
          const lang = object(language),
            setup = text(lang.setup);
          const outputs = children(lang, 'outputConfigurations', 'outputConfiguration');
          for (const [outputIndex, output] of (outputs.length
            ? outputs
            : [{ outputDirectory: 'src/generated/java' }]
          ).entries()) {
            const outputPath = portable(object(output).outputDirectory, model, origin);
            if (!outputPath) continue;
            const id = [
              directory(model.path) || 'root',
              text(node.id) || 'execution-' + index,
              languageIndex,
              outputIndex
            ]
              .join('.')
              .replace(/[^a-zA-Z0-9_.-]/g, '-');
            const generator = setup === 'com.regnosys.rosetta.RosettaStandaloneSetup' ? 'java' : 'maven-language';
            preview.build.targets[id] = { generator, output: outputPath, options: {} };
            report(
              'MAVEN_GENERATOR_UNAVAILABLE',
              origin,
              'Generator metadata was retained; its Java/setup implementation is not installed.',
              'unsupported',
              { plugin: key, version, configuration: config },
              ['generator:' + generator],
              [id]
            );
          }
        }
      }
    }
  }
  for (const id of selected)
    if (!foundProfiles.has(id))
      report(
        'MAVEN_PROFILE_UNRESOLVED',
        input.pomPath + '#profiles/' + id,
        'Selected profile was not found in inspected metadata.',
        'unresolved'
      );
  for (const item of preview.report) {
    if (item.status === 'translated' || item.targets.length) continue;
    const scope = directory(item.path.split('#')[0]!);
    const prefix = (scope || 'root').replace(/[^a-zA-Z0-9_.-]/g, '-') + '.';
    item.targets = Object.keys(preview.build.targets).filter((name) => !scope || name.startsWith(prefix));
  }
  if (sources.size) preview.build.sources = [...sources];
  if (resources.size) preview.build.resources = [...resources].map((path) => ({ path }));
  const rootConfig = ['rune-config.yml', 'rune-config.yaml'].find((path) => files.has(path));
  if (rootConfig) preview.build.runeConfig = rootConfig;
  else if (runeConfigs.size === 1) preview.build.runeConfig = [...runeConfigs][0]!;
  else if (runeConfigs.size > 1)
    report(
      'MAVEN_RUNE_CONFIG_AMBIGUOUS',
      input.pomPath,
      'Choose one Rune configuration before building this multi-module project.',
      'unresolved',
      [...runeConfigs]
    );
  let reportPath = 'build-config.import.json';
  for (let index = 1; files.has(reportPath); index++) reportPath = 'build-config.import-' + index + '.json';
  preview.build.importReport = reportPath;
  if (!fatal) preview.writes = mavenPreviewWrites(preview, files);
  return preview;
}
