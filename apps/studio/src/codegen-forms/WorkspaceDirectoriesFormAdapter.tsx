// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import GeneratedForm from './workspace-directories.schema?z2f';
import type { WorkspaceDirectoriesFormProps } from '../components/WorkspaceConfiguration.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkspaceDirectoriesFormAdapter = withInstrumentation(
  function WorkspaceDirectoriesFormAdapter({ value, onChange }: WorkspaceDirectoriesFormProps) {
    return (
      <GeneratedForm
        defaultValues={value}
        onValueChange={(value: unknown) => onChange(value as Record<string, unknown>)}
      />
    );
  },
  { op: 'WorkspaceDirectoriesFormAdapter', capture: 0 }
);
