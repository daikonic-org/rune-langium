// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { StudioConfigSchema } from '@rune-langium/project-config';

// Keep validation/defaults in the portable configuration contract; hide only the format version.
export const WorkspaceDirectoriesSchema = StudioConfigSchema.omit({ schemaVersion: true });
export default WorkspaceDirectoriesSchema;
