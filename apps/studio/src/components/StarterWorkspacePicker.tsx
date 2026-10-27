// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { listStarterProjects, type StarterProject } from '../services/starter-registry.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const StarterWorkspacePicker = withInstrumentation(
  function StarterWorkspacePicker({
    catalog = listStarterProjects(),
    open
  }: {
    catalog?: readonly StarterProject[];
    open?: (starter: StarterProject, signal: AbortSignal) => Promise<unknown>;
  }) {
    const [selected, setSelected] = useState(catalog[0]?.id),
      [query, setQuery] = useState(''),
      [detail, setDetail] = useState(false),
      [busy, setBusy] = useState(false),
      [error, setError] = useState<string>();
    const current = useRef<AbortController | undefined>(undefined),
      selection = useRef<HTMLButtonElement | null>(null);
    const cancel = () => {
      current.current?.abort();
      current.current = undefined;
      setBusy(false);
    };
    useEffect(() => () => current.current?.abort(), []);
    const matches = catalog.filter((entry) =>
      `${entry.name} ${entry.description} ${entry.repository}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    );
    const active = matches.find((entry) => entry.id === selected);
    const useExample = async () => {
      if (!active || !open || active.status !== 'available') return;
      cancel();
      const operation = new AbortController();
      current.current = operation;
      setBusy(true);
      setError(undefined);
      try {
        await open(active, operation.signal);
      } catch (error) {
        if (!operation.signal.aborted)
          setError(error instanceof Error ? error.message : 'The example could not be opened. Try again.');
      } finally {
        if (current.current === operation) {
          current.current = undefined;
          setBusy(false);
        }
      }
    };
    return (
      <section className="starter-section" aria-labelledby="starter-heading">
        <div className="studio-launcher__section-heading">
          <h2 id="starter-heading">Start from example</h2>
          <span>Editable GitHub projects</span>
        </div>
        <div className={`starter-picker ${detail && active ? 'starter-picker--detail' : ''}`}>
          <div className="starter-picker__list">
            <Input
              aria-label="Search example projects"
              placeholder="Search example projects…"
              value={query}
              onChange={(event) => {
                cancel();
                setQuery(event.target.value);
                setError(undefined);
              }}
            />
            {query && (
              <Button variant="ghost" size="xs" onClick={() => setQuery('')}>
                Clear search
              </Button>
            )}
            <ul aria-label="Example projects">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    ref={entry.id === selected ? selection : undefined}
                    aria-pressed={entry.id === selected}
                    onClick={() => {
                      cancel();
                      setSelected(entry.id);
                      setDetail(true);
                      setError(undefined);
                    }}
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.description}</span>
                    {entry.status !== 'available' && <small>Not published</small>}
                  </button>
                </li>
              ))}
            </ul>
            {!matches.length && <p className="starter-picker__empty">No matching example projects.</p>}
          </div>
          <div className="starter-picker__detail" aria-live="polite">
            {active ? (
              <>
                <Button
                  className="starter-picker__back"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setDetail(false);
                    requestAnimationFrame(() => selection.current?.focus());
                  }}
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  Back to examples
                </Button>
                <h3>{active.name}</h3>
                <p>{active.description}</p>
                <a
                  href={`https://github.com/${active.repository}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="starter-picker__repository"
                >
                  {active.repository}
                  <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <dl>
                  <dt>Includes</dt>
                  <dd>
                    <ul>
                      {active.examples.map((example) => (
                        <li key={example}>{example}</li>
                      ))}
                    </ul>
                  </dd>
                  <dt>Requires</dt>
                  <dd>{active.requiredCapabilities.join(', ') || 'Rune standard library'}</dd>
                  <dt>Saved files</dt>
                  <dd>Configuration, sources, examples and shared layouts</dd>
                </dl>
                {active.status === 'unavailable' && (
                  <p className="starter-picker__notice">
                    This proposed example is not published. It will be available after its repository and contents are
                    verified.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy || active.status !== 'available' || !open}
                    onClick={() => void useExample()}
                  >
                    {busy && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                    {busy ? 'Opening example…' : 'Use example'}
                  </Button>
                  {busy && (
                    <Button size="sm" variant="ghost" onClick={cancel}>
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="starter-picker__notice">
                  Open an editable copy without signing in. Clone, fork or connect a writable repository before
                  committing or pushing.
                </p>
                {busy && <p role="status">Checking source and preparing your working copy…</p>}
                {error && (
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                )}
              </>
            ) : (
              <div className="starter-picker__empty">
                <p>
                  {query
                    ? 'The selected example is hidden by this search.'
                    : 'Select an example to see its files and requirements.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  },
  { op: 'StarterWorkspacePicker', capture: 0 }
);
