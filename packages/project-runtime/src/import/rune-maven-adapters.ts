// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { validateReferenceCatalog, type ReferenceCatalog } from '@rune-langium/curated-schema';
import { refreshMavenPreviewWrites, type MavenDependency, type MavenImportPreview } from '@rune-langium/project-config';
/** An artifact version is evidence to match, never a guessed Git release tag. */
export function mapMavenReferences(preview: MavenImportPreview, catalog: ReferenceCatalog): MavenImportPreview {
  const copy = structuredClone(preview);
  copy.build.references = Object.assign(Object.create(null), copy.build.references);
  const releases = validateReferenceCatalog(catalog).releases;
  const matches = (dependency: MavenDependency) =>
    releases.filter((release) =>
      release.mavenArtifacts?.some(
        (artifact) =>
          artifact.groupId === dependency.groupId &&
          artifact.artifactId === dependency.artifactId &&
          artifact.version === dependency.version &&
          artifact.type === dependency.type &&
          (artifact.classifier ?? '') === (dependency.classifier ?? '')
      )
    );
  const requests = new Map<string, { repository: string; release: string; paths: Set<string> }[]>();
  for (const dependency of copy.dependencies) {
    const candidates = new Map(
      matches(dependency).map((release) => [
        JSON.stringify([release.modelId, release.repository, release.tag, release.commit]),
        release
      ])
    );
    if (candidates.size !== 1) {
      if (candidates.size > 1)
        copy.report.push({
          code: 'MAVEN_REFERENCE_AMBIGUOUS',
          path: dependency.path,
          message: 'Artifact coordinates match several source releases; choose explicitly.',
          status: 'unresolved',
          targets: [],
          capabilities: ['reference:' + dependency.groupId + ':' + dependency.artifactId],
          evidence: dependency
        });
      continue;
    }
    const release = [...candidates.values()][0]!;
    const entries = requests.get(release.modelId) ?? [];
    const existing = entries.find((entry) => entry.repository === release.repository && entry.release === release.tag);
    if (existing) existing.paths.add(dependency.path);
    else entries.push({ repository: release.repository, release: release.tag, paths: new Set([dependency.path]) });
    requests.set(release.modelId, entries);
  }
  for (const [modelId, entries] of requests) {
    if (entries.length !== 1) {
      copy.report.push({
        code: 'MAVEN_REFERENCE_AMBIGUOUS',
        path: copy.provenance.pomPath,
        message: 'Several Maven dependencies require different releases of ' + modelId + '.',
        status: 'unresolved',
        targets: [],
        capabilities: ['reference:' + modelId]
      });
      continue;
    }
    const entry = entries[0]!;
    const current = copy.build.references[modelId];
    if (current && (current.repository !== entry.repository || current.release !== entry.release)) continue;
    copy.build.references[modelId] = { repository: entry.repository, release: entry.release };
    copy.report = copy.report.map((item) =>
      entry.paths.has(item.path) && item.code === 'MAVEN_DEPENDENCY_UNRESOLVED'
        ? {
            ...item,
            code: 'MAVEN_REFERENCE_MAPPED',
            status: 'translated',
            message: 'Explicit catalog mapping: ' + entry.repository + '@' + entry.release,
            capabilities: ['reference:' + modelId]
          }
        : item
    );
  }
  return refreshMavenPreviewWrites(copy);
}
