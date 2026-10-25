// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { openLocalProject } from '@rune-langium/project-runtime/node';
import { buildProject, type ProjectBuildResult } from '@rune-langium/project-runtime';
import { ProjectSnapshotError } from '@rune-langium/project-config';

export interface BuildCommandOptions {
  project: string;
  target?: string[];
  all?: boolean;
  json?: boolean;
}
function report(result: ProjectBuildResult, json: boolean | undefined): void {
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const diagnostic of result.diagnostics) console.error(diagnostic.path + ': ' + diagnostic.message);
    for (const output of result.outputs) console.log(output);
  }
}
export async function runBuild(options: BuildCommandOptions): Promise<number> {
  if (Boolean(options.all) === Boolean(options.target?.length)) {
    report(
      {
        status: 'failed',
        outputs: [],
        diagnostics: [
          {
            code: 'TARGET_REQUIRED',
            severity: 'error',
            path: 'targets',
            message: 'Choose --target <name...> or --all, without combining them.'
          }
        ]
      },
      options.json
    );
    return 2;
  }
  try {
    const { snapshot, adapter } = await openLocalProject(options.project);
    const result = await buildProject(snapshot, { targets: options.all ? 'all' : options.target! }, adapter);
    report(result, options.json);
    return result.status === 'success' ? 0 : 1;
  } catch (failure) {
    report(
      {
        status: 'failed',
        outputs: [],
        diagnostics:
          failure instanceof ProjectSnapshotError
            ? [...failure.diagnostics]
            : [
                {
                  code: 'BUILD_FAILED',
                  severity: 'error',
                  path: options.project,
                  message: failure instanceof Error ? failure.message : 'Project build failed.'
                }
              ]
      },
      options.json
    );
    return 1;
  }
}
