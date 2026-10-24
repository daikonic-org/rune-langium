// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

const REPOSITORIES = {
  cdm: { owner: 'finos', repo: 'common-domain-model' },
  fpml: { owner: 'rosetta-models', repo: 'rune-fpml' },
  'rune-dsl': { owner: 'finos', repo: 'rune-dsl' }
};

function dependencyVersion(pom, property) {
  const escaped = property.replaceAll('.', '\\.');
  const version = new RegExp(`<${escaped}>\\s*([^<]+?)\\s*</${escaped}>`).exec(pom)?.[1];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Expected an explicit release version for ${property} in the upstream POM`);
  return version;
}

/** Follow CDM development while honoring its released FpML and Rune dependencies. */
export async function resolveCuratedSources(fetchImpl = fetch, { cdmRelease } = {}) {
  if (cdmRelease !== undefined && (typeof cdmRelease !== 'string' || !cdmRelease.trim()))
    throw new Error('Choose an explicit CDM release tag');
  async function github(path) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetchImpl(`https://api.github.com/repos/${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status} while resolving ${path}`);
    return response.json();
  }

  async function resolve(id, ref) {
    const repository = REPOSITORIES[id];
    const prefix = `${repository.owner}/${repository.repo}`;
    let commit;
    if (cdmRelease !== undefined) {
      const release = await github(`${prefix}/releases/tags/${encodeURIComponent(ref)}`);
      if (release.tag_name !== ref) throw new Error(`Release tag mismatch for ${id}@${ref}`);
      let object = (await github(`${prefix}/git/ref/tags/${encodeURIComponent(ref)}`)).object;
      for (let depth = 0; object?.type === 'tag' && depth < 16; depth++) {
        if (!/^[a-f0-9]{40}$/.test(object.sha)) throw new Error(`Invalid annotated tag for ${id}@${ref}`);
        object = (await github(`${prefix}/git/tags/${object.sha}`)).object;
      }
      if (object?.type !== 'commit') throw new Error(`Release tag does not resolve to a commit: ${id}@${ref}`);
      commit = object.sha;
    } else {
      commit = (await github(`${prefix}/commits/${encodeURIComponent(ref)}`)).sha;
    }
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Invalid upstream commit for ${id}@${ref}`);
    return { id, ...repository, ref, commit, ...(cdmRelease !== undefined ? { release: { tag: ref, commit } } : {}) };
  }

  async function pom(source) {
    const result = await github(`${source.owner}/${source.repo}/contents/pom.xml?ref=${source.commit}`);
    if (result.encoding !== 'base64' || typeof result.content !== 'string')
      throw new Error(`Missing upstream POM for ${source.id}@${source.commit}`);
    return Buffer.from(result.content, 'base64').toString('utf8');
  }

  const cdm = await resolve('cdm', cdmRelease ?? 'master');
  const cdmPom = await pom(cdm);
  const runeVersion = dependencyVersion(cdmPom, 'rosetta.dsl.version');
  const [fpml, rune] = await Promise.all([
    resolve('fpml', dependencyVersion(cdmPom, 'rune-fpml.version')),
    resolve('rune-dsl', runeVersion)
  ]);
  const fpmlRuneVersion = dependencyVersion(await pom(fpml), 'rosetta.dsl.version');
  const [major, minor, patch] = runeVersion.split('.').map(Number);
  const [fpmlMajor, fpmlMinor, fpmlPatch] = fpmlRuneVersion.split('.').map(Number);
  // CDM's direct dependency mediates FpML's older transitive runtime requirement.
  if (major !== fpmlMajor || minor < fpmlMinor || (minor === fpmlMinor && patch < fpmlPatch))
    throw new Error(`Incompatible Rune dependencies: CDM requires ${runeVersion}, FpML requires ${fpmlRuneVersion}`);
  return [cdm, fpml, rune];
}
