// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Compile the emitted schema closure with libxml2 and validate an actual instance. */
export function validateGeneratedXsd(
  outputs: readonly { relativePath: string; content: string }[],
  entry: { path: string; namespace: string; type: string },
  instance: string
) {
  const root = mkdtempSync(join(tmpdir(), 'rune-xsd-validation-'));
  try {
    for (const output of outputs) {
      const path = join(root, output.relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, output.content);
    }
    writeFileSync(
      join(root, 'validation-wrapper.xsd'),
      `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:model="${entry.namespace}" targetNamespace="urn:rune:test">
  <xs:import namespace="${entry.namespace}" schemaLocation="${entry.path}"/>
  <xs:element name="Document" type="model:${entry.type}"/>
</xs:schema>`
    );
    writeFileSync(join(root, 'instance.xml'), instance);
    const result = spawnSync(
      process.env.XMLLINT_BINARY ?? 'xmllint',
      ['--noout', '--nonet', '--schema', 'validation-wrapper.xsd', 'instance.xml'],
      { cwd: root, encoding: 'utf8' }
    );
    return { status: result.status, error: result.error?.message, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
