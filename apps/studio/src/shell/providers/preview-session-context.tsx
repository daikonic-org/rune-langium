// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, useEffect, useState } from 'react';
import type { PreviewSessionClient } from '../../services/preview-session-client.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export type PreviewSessionFactory = () => PreviewSessionClient;
export const PreviewSessionContext = createContext<PreviewSessionFactory | null>(null);
export const usePreviewSessionFactory = withInstrumentation(
  function usePreviewSessionFactory(): PreviewSessionFactory | null {
    return useContext(PreviewSessionContext);
  },
  { op: 'usePreviewSessionFactory' }
);

export interface ProjectPreviewReadiness {
  ensureSaved(
    revision: string,
    signal: AbortSignal
  ): Promise<import('../../services/project-runtime-input.js').ProjectRuntimeInput>;
}
export const ProjectPreviewReadinessContext = createContext<ProjectPreviewReadiness | null>(null);
export const useProjectPreviewReadiness = withInstrumentation(
  function useProjectPreviewReadiness(): ProjectPreviewReadiness | null {
    return useContext(ProjectPreviewReadinessContext);
  },
  { op: 'useProjectPreviewReadiness' }
);

/** Own clients in an effect so Strict Mode's setup/cleanup replay cannot reuse a disposed client. */
export const usePreviewSession = withInstrumentation(
  function usePreviewSession(): PreviewSessionClient | undefined {
    const factory = usePreviewSessionFactory();
    const [client, setClient] = useState<PreviewSessionClient>();
    useEffect(() => {
      const current = factory?.();
      setClient(current);
      return () => current?.dispose();
    }, [factory]);
    return client;
  },
  { op: 'usePreviewSession', capture: 0 }
);
