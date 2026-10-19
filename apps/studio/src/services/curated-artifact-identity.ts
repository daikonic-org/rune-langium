// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { z } from 'zod';
import { CuratedModelIdSchema } from '@rune-langium/curated-schema';

const ArtifactKeySchema = z.tuple([CuratedModelIdSchema, z.string()]);

export const curatedArtifactIdentity = withInstrumentation(
  function curatedArtifactIdentity(key: string): { bundleId: string; artifact: string } | undefined {
    try {
      const parsed = ArtifactKeySchema.safeParse(JSON.parse(key));
      if (!parsed.success) return undefined;
      const [bundleId, artifact] = parsed.data;
      const prefix = `https://www.daikonic.dev/curated/${bundleId}/`;
      const path = artifact.startsWith(prefix) ? artifact.slice(prefix.length) : artifact;
      // The publisher includes the content digest in this directory. Floating
      // pointers and legacy date-only paths must always go through the server.
      return /^artifacts\/\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\/ns\/[^/?#]+\.json\.gz$/.test(path)
        ? { bundleId, artifact }
        : undefined;
    } catch {
      return undefined;
    }
  },
  { op: 'curatedArtifactIdentity', level: 'trace', capture: 0 }
);
