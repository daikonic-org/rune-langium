// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { z } from 'zod';
import type {
  BuildConfigSchema,
  BuildTargetSchema,
  ProjectLockSchema,
  ProjectOverrideSchema,
  ReferenceRequestSchema,
  StudioConfigSchema,
  SymbolIdentitySchema
} from './config-schema.js';
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
export type BuildTarget = z.infer<typeof BuildTargetSchema>;
export type ProjectLock = z.infer<typeof ProjectLockSchema>;
export type ProjectOverride = z.infer<typeof ProjectOverrideSchema>;
export type ReferenceRequest = z.infer<typeof ReferenceRequestSchema>;
export type StudioConfig = z.infer<typeof StudioConfigSchema>;
export type SymbolIdentity = z.infer<typeof SymbolIdentitySchema>;
export interface ProjectDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
  target?: string;
}
export type ProjectFiles = ReadonlyMap<string, string>;
export interface ConfigDocument {
  path: string;
  text: string;
}
export interface ConfigResult<T> {
  value?: T;
  diagnostics: ProjectDiagnostic[];
}
export type TargetValidator = (target: BuildTarget) => ProjectDiagnostic[];
export interface NormalizedProject {
  build: BuildConfig;
  studio: StudioConfig;
  rune: Readonly<Record<string, unknown>>;
  diagnostics: ProjectDiagnostic[];
}
export interface ProjectSnapshot {
  workspaceId: string;
  revision: string;
  files: ProjectFiles;
  fileRevisions: ReadonlyMap<string, string>;
  project: NormalizedProject;
  lock?: ProjectLock;
}
