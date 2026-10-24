// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { Alert, AlertDescription } from '@rune-langium/design-system/ui/alert';
import type { GitHubInitializationSession, ReviewedMavenImportPreview } from '../workspace/project-initialization.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const ProjectInitializationReview = withInstrumentation(
  function ProjectInitializationReview({
    session,
    onContinue
  }: {
    session: GitHubInitializationSession;
    onContinue(): void | Promise<void>;
  }) {
    const profileId = useId();
    const attempt = useRef(0);
    const [profiles, setProfiles] = useState('');
    const [preview, setPreview] = useState<ReviewedMavenImportPreview>();
    const [busy, setBusy] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    async function review(selected: readonly string[]) {
      const epoch = ++attempt.current;
      setBusy(true);
      setError(undefined);
      setPreview(undefined);
      try {
        const next = await session.prepare(selected);
        if (epoch === attempt.current) setPreview(next);
      } catch (cause) {
        if (epoch === attempt.current)
          setError(
            cause instanceof Error ? cause.message : 'Project inspection is unavailable. Try again or keep browsing.'
          );
      } finally {
        if (epoch === attempt.current) setBusy(false);
      }
    }
    useEffect(() => {
      void review([]);
      return () => {
        attempt.current++;
      };
    }, [session]);

    return (
      <section
        aria-label="Review detected project settings"
        className="flex min-w-0 flex-col gap-3 text-sm text-left"
        aria-busy={busy}
      >
        <div>
          <h3 className="font-semibold">Project settings detected</h3>
          <p className="mt-1 text-foreground/75">
            Your repository is open. Review native build settings detected from pom.xml, or keep browsing without adding
            them.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor={profileId} className="text-xs text-foreground/75">
            Profiles (optional)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={profileId}
              className="min-w-0 flex-1"
              value={profiles}
              disabled={busy}
              placeholder="Profile names, separated by commas"
              onChange={(event) => setProfiles(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void review(
                  profiles
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean)
                )
              }
            >
              Review profiles
            </Button>
          </div>
        </div>
        {busy && (
          <p role="status" className="text-foreground/75">
            Reviewing project settings…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {preview && (
          <>
            <div>
              <p className="mb-2 text-xs text-foreground/75">
                Reviewed profiles: {preview.provenance.profiles.join(', ') || 'none'}
              </p>
              <h4 className="font-medium">Files to add</h4>
              <ul className="mt-1 space-y-1">
                {preview.writes.map((write) => (
                  <li key={write.path} className="break-all font-mono text-xs">
                    {write.path}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-foreground/75">
                The POM stays unchanged. Save updates this working copy; commit and push are separate.
              </p>
            </div>
            <div>
              <h4 className="font-medium">Compatibility review</h4>
              <ul
                className="studio-scroll mt-1 max-h-56 space-y-2 overflow-auto pr-1"
                aria-label="Initialization compatibility report"
              >
                {preview.report.map((item, i) => (
                  <li
                    key={item.path + ':' + item.code + ':' + i}
                    className="min-w-0 border-b border-border/50 pb-2 last:border-0"
                  >
                    <p className="text-xs text-foreground/75 capitalize">
                      {item.status}
                      {item.targets.length ? ' · ' + item.targets.join(', ') : ''}
                    </p>
                    <p className="break-words">{item.message}</p>
                    <p className="break-all font-mono text-xs text-foreground/75">{item.path}</p>
                  </li>
                ))}
              </ul>
              {!preview.report.length && <p className="text-foreground/75">No compatibility findings.</p>}
              <p className="mt-2 text-xs text-foreground/75">
                Imported settings do not make unsupported generators or implementations available.
              </p>
            </div>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void onContinue()}>
            Keep browsing
          </Button>
          <Button
            size="sm"
            disabled={busy || !preview?.writes.length}
            onClick={async () => {
              if (!preview) return;
              setBusy(true);
              setSaving(true);
              setError(undefined);
              try {
                await session.save(preview);
                await onContinue();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Project settings could not be saved. Your repository is still available.'
                );
              } finally {
                setBusy(false);
                setSaving(false);
              }
            }}
          >
            Initialize project settings
          </Button>
        </div>
      </section>
    );
  },
  { op: 'ProjectInitializationReview', sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);
