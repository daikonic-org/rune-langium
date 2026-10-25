// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { Disclosure } from '@rune-langium/design-system/ui/collapsible';
import type { ImportReportItem } from '@rune-langium/project-config';
import type { ProjectInitializationStatus } from '@rune-langium/project-runtime/status';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const ProjectImportFindings = withInstrumentation(
  function ProjectImportFindings({ report }: { report: readonly ImportReportItem[] }) {
    return (
      <ul
        className="studio-scroll mt-1 max-h-56 space-y-2 overflow-auto pr-1"
        aria-label="Initialization compatibility report"
      >
        {report.map((item, i) => (
          <li
            key={item.path + ':' + item.code + ':' + i}
            className="min-w-0 border-b border-border/50 pb-2 last:border-0"
          >
            <p className="text-xs text-foreground/75">
              <span className="capitalize">{item.status}</span>
              {item.targets.length ? ' · ' + item.targets.join(', ') : ''}
            </p>
            <p className="break-words">{item.message}</p>
            <p className="break-all font-mono text-xs text-foreground/75">{item.path}</p>
            {item.evidence !== undefined && (
              <Disclosure label="Source evidence">
                <pre className="studio-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words px-1 py-2 text-xs">
                  {JSON.stringify(item.evidence, null, 2)}
                </pre>
              </Disclosure>
            )}
          </li>
        ))}
      </ul>
    );
  },
  { op: 'ProjectImportFindings', sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

export const ProjectInitializationEvidence = withInstrumentation(
  function ProjectInitializationEvidence({ status }: { status: ProjectInitializationStatus }) {
    return (
      <>
        {status.reportDiagnostics.map((issue) => (
          <p role="alert" key={issue.code} className="text-xs text-foreground/75">
            {issue.message}
          </p>
        ))}
        {status.report && (
          <Disclosure label="Saved initialization report">
            <div className="min-w-0 space-y-2 px-1 pb-2 text-xs">
              <p className="text-foreground/75">
                Saved from the original import. Current build and function checks determine what can run.
              </p>
              <p>Profiles: {status.report.provenance.profiles.join(', ') || 'none'}</p>
              <ProjectImportFindings report={status.report.report} />
            </div>
          </Disclosure>
        )}
      </>
    );
  },
  { op: 'ProjectInitializationEvidence', sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);
