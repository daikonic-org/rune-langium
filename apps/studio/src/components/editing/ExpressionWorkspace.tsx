// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState, useRef, useId, type CSSProperties } from 'react';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { ExpressionEditorSlotProps, FunctionScope } from '@rune-langium/visual-editor';
import { nameFromNodeId, kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import {
  getFunctionImplementationRegion,
  getExpressionRegions,
  findExpressionOwner,
  type RosettaFunction,
  type Data,
  type Dehydrated,
  type SourceRegion,
  type ExpressionRegion
} from '@rune-langium/core';
import type { WorkspaceFile, ParsedWorkspaceModel } from '../../services/workspace.js';
import type { DocumentBinding, DocumentEdit, ExpressionDocument } from '../../services/expression-document.js';
import type { LspClientService } from '../../services/lsp-client.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { pathToUri } from '../../utils/uri.js';
import { ExpressionBuilderDialog } from './ExpressionBuilderDialog.js';
import { RuneRegionEditor } from './RuneRegionEditor.js';
import { GeneratedExpressionView } from './GeneratedExpressionView.js';
import { useExpressionProjection } from './use-expression-projection.js';
import { ForeignExpressionDialog } from './ForeignExpressionDialog.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { protectedRegion } from '../../lang/document-extensions.js';

export interface ExpressionWorkspaceProps {
  nodeId: string;
  file?: WorkspaceFile;
  parsed?: ParsedWorkspaceModel;
  documents: ExpressionDocument;
  parseCurrent: boolean;
  readOnly: boolean;
  onContentChange(path: string, fullSource: string): void;
  onOpenSource(): void;
  lspClient?: LspClientService;
  lspReady?: boolean;
  sourceError?: string;
  sourceOwner?: RosettaFunction | Data | Dehydrated<RosettaFunction> | Dehydrated<Data>;
  loadScope?: (region: SourceRegion) => Promise<FunctionScope>;
  target?: ExpressionEditorSlotProps['target'];
  dependencySnapshot?: readonly WorkspaceFile[];
}

export const ExpressionWorkspace = withInstrumentation(
  function ExpressionWorkspace({
    nodeId,
    file,
    parsed,
    documents,
    parseCurrent,
    readOnly,
    onContentChange,
    onOpenSource,
    lspClient,
    lspReady,
    sourceError,
    sourceOwner,
    loadScope,
    target,
    dependencySnapshot
  }: ExpressionWorkspaceProps) {
    const dependenciesRef = useRef(dependencySnapshot);
    dependenciesRef.current = dependencySnapshot;
    const [binding, setBinding] = useState<DocumentBinding | null>(null);
    const [expanded, setExpanded] = useState(false);
    const editorId = useId();
    const viewRef = useRef<EditorView | null>(null);
    const [selection, setSelection] = useState<SourceRegion | null>(null);
    const [builder, setBuilder] = useState<{
      binding: DocumentBinding;
      target: ExpressionRegion;
      scope: FunctionScope;
      dependencies: ExpressionWorkspaceProps['dependencySnapshot'];
    } | null>(null);
    const [builderPending, setBuilderPending] = useState(false);
    const [foreign, setForeign] = useState<{
      binding: DocumentBinding;
      region: SourceRegion;
      language: 'typescript' | 'python';
      dependencies: ExpressionWorkspaceProps['dependencySnapshot'];
    } | null>(null);
    const [builderError, setBuilderError] = useState<string>();
    const requestRef = useRef(0);
    useEffect(
      () => () => {
        requestRef.current++;
        viewRef.current = null;
      },
      []
    );
    const [coordinateError, setCoordinateError] = useState<string | undefined>();
    const regionKey = target ? `${target.kind}:${target.index}` : 'implementation';
    useEffect(() => {
      if (!file || file.sourceLoaded === false) return;
      const owner =
        parsed && parseCurrent
          ? findExpressionOwner(parsed.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) })
          : readOnly
            ? sourceOwner
            : undefined;
      if (!owner || (owner.$type !== 'RosettaFunction' && owner.$type !== 'Data')) {
        if (parseCurrent) {
          setBinding(null);
          setCoordinateError('The selected declaration is no longer present in the current source.');
          return;
        }
        const recovered = documents.recoverRegion(pathToUri(file.path), nodeId, regionKey);
        setBinding(recovered);
        if (recovered) setCoordinateError(undefined);
        return;
      }
      try {
        const region = target
          ? getExpressionRegions(owner).find((entry) => entry.kind === target.kind && entry.index === target.index)
              ?.region
          : owner.$type === 'RosettaFunction'
            ? getFunctionImplementationRegion(owner, file.content)
            : undefined;
        if (!region) {
          setCoordinateError('Source coordinates are unavailable for this expression. Open the file in Source.');
          return;
        }
        const next = documents.capture(pathToUri(file.path), nodeId, region);
        if (next) {
          documents.retainRegion(next, regionKey);
          setBinding(next);
          setCoordinateError(undefined);
        } else setCoordinateError('Source coordinates do not match this file. Open the file in Source.');
      } catch (error) {
        setCoordinateError(error instanceof Error ? error.message : String(error));
      }
    }, [file, parsed, parseCurrent, sourceOwner, readOnly, nodeId, documents, target?.kind, target?.index]);
    const active =
      file &&
      !coordinateError &&
      file.sourceLoaded !== false &&
      binding?.uri === pathToUri(file.path) &&
      binding.nodeId === nodeId
        ? binding
        : null;
    const [language, setLanguage] = useState<'rune' | 'typescript' | 'python'>('rune');
    const projection = useExpressionProjection(
      language,
      active,
      Boolean(active && file && (readOnly || file.readOnly || (parseCurrent && parsed?.source === file.content))),
      target ? 'condition' : 'function',
      dependencySnapshot
    );
    const captureTarget = () => {
      if (!active || !file || !parsed || !parseCurrent || readOnly || file.readOnly || active.readOnly) return;
      const owner = findExpressionOwner(parsed.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) });
      if (!owner || (owner.$type !== 'RosettaFunction' && owner.$type !== 'Data')) return;
      const entries = getExpressionRegions(owner);
      const expression = target
        ? entries.find((entry) => entry.kind === target.kind && entry.index === target.index)
        : entries.find((entry) => selection && entry.region.from <= selection.from && entry.region.to >= selection.to);
      if (!expression) {
        setBuilderError('Place the cursor inside an expression to open the builder.');
        return;
      }
      const captured = documents.capture(active.uri, nodeId, active.region);
      if (!captured || captured.source !== parsed.source) return;
      return { binding: captured, target: expression, dependencies: dependencySnapshot };
    };
    const openBuilder = async () => {
      if (!loadScope) return;
      const selected = captureTarget();
      if (!selected) return;
      const { binding: captured, target: expression, dependencies } = selected;
      const request = ++requestRef.current;
      setBuilderPending(true);
      setBuilderError(undefined);
      try {
        const scope = await loadScope(expression.region);
        if (request !== requestRef.current) return;
        const current = documents.capture(captured.uri, nodeId, captured.region);
        if (
          !current ||
          current.workspaceGeneration !== captured.workspaceGeneration ||
          current.revision !== captured.revision ||
          dependenciesRef.current !== dependencies
        ) {
          setBuilderError('The source changed. Reopen the builder to apply this draft.');
          return;
        }
        setBuilder({ binding: captured, target: expression, scope, dependencies });
      } catch (error) {
        if (request === requestRef.current) setBuilderError(error instanceof Error ? error.message : String(error));
      } finally {
        if (request === requestRef.current) setBuilderPending(false);
      }
    };
    const applyExpressionEdit = (edit: DocumentEdit, dependencies: ExpressionWorkspaceProps['dependencySnapshot']) => {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() !== edit.binding.source || dependenciesRef.current !== dependencies)
        return { ok: false as const, reason: 'stale' as const };
      return documents.applyDocumentEdit(edit, () =>
        view.dispatch({
          changes: { ...edit.region, insert: edit.replacement },
          annotations: isolateHistory.of('full'),
          userEvent: 'input.expression-dialog'
        })
      );
    };
    const returnFocus = () => requestAnimationFrame(() => viewRef.current?.focus());
    return (
      <section
        id={editorId}
        className="flex flex-col gap-1"
        aria-label={target ? 'Condition expression' : 'Function implementation'}
        style={{ '--expression-editor-height': expanded ? 'min(70dvh,48rem)' : 'min(45dvh,28rem)' } as CSSProperties}
      >
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-1">
          <span className="text-xs font-medium text-muted-foreground">{target ? 'Expression' : 'Implementation'}</span>
          <div className="flex flex-wrap items-center gap-1">
            {(['rune', 'typescript', 'python'] as const).map((choice) => (
              <Button
                key={choice}
                variant="ghost"
                size="xs"
                aria-pressed={language === choice}
                onClick={() => setLanguage(choice)}
              >
                {{ rune: 'Rune', typescript: 'TypeScript', python: 'Python' }[choice]}
              </Button>
            ))}
            {language !== 'rune' && (
              <Button
                variant="ghost"
                size="xs"
                disabled={!active || !parseCurrent || readOnly || file?.readOnly || active?.readOnly}
                onClick={() => {
                  const selected = captureTarget();
                  if (selected)
                    setForeign({
                      binding: selected.binding,
                      region: selected.target.region,
                      language,
                      dependencies: selected.dependencies
                    });
                }}
              >
                Edit expression…
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              disabled={
                !active ||
                !parseCurrent ||
                readOnly ||
                file?.readOnly ||
                active?.readOnly ||
                !loadScope ||
                builderPending
              }
              onClick={openBuilder}
            >
              {builderPending ? 'Opening…' : 'Builder'}
            </Button>
            <Button variant="ghost" size="xs" onClick={onOpenSource}>
              Open in Source
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-expanded={expanded}
              aria-controls={editorId}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Collapse editor' : 'Expand editor'}
            </Button>
          </div>
        </div>
        <div hidden={language !== 'rune'}>
          {active && file ? (
            <RuneRegionEditor
              binding={{ ...active, readOnly: readOnly || Boolean(file.readOnly) || active.readOnly }}
              path={file.path}
              source={file.content}
              onContentChange={(path, source) => {
                const region = viewRef.current?.state.field(protectedRegion, false);
                if (region) documents.retainRegion(active, regionKey, source, region);
                onContentChange(path, source);
              }}
              lspClient={lspClient}
              lspReady={lspReady}
              onViewCreated={(view) => {
                viewRef.current = view;
              }}
              onSelectionChange={(range) => setSelection(range)}
            />
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {sourceError ??
                coordinateError ??
                (file?.sourceLoaded === false ? 'Loading source…' : 'Waiting for the current Rune source to parse…')}
            </p>
          )}
        </div>
        {language !== 'rune' && (
          <>
            <p className="text-xs text-muted-foreground">Generated · read-only</p>
            {'projection' in projection && projection.projection && (
              <GeneratedExpressionView projection={projection.projection} />
            )}
            {projection.status === 'loading' && (
              <p role="status" className="text-xs text-muted-foreground">
                Generating…
              </p>
            )}
            {projection.status === 'stale' && (
              <p role="status" className="text-xs text-muted-foreground">
                Showing the last valid source. The current Rune draft is pending or invalid.
              </p>
            )}
            {projection.status === 'error' && (
              <p role="alert" className="text-xs text-destructive">
                {projection.error}
              </p>
            )}
          </>
        )}
        {builderError && (
          <p role="alert" className="text-xs text-destructive">
            {builderError}
          </p>
        )}
        {builder && (
          <ExpressionBuilderDialog
            {...builder}
            onClose={() => {
              setBuilder(null);
              returnFocus();
            }}
            onApply={(edit) => applyExpressionEdit(edit, builder.dependencies)}
          />
        )}
        {foreign && (
          <ForeignExpressionDialog
            {...foreign}
            onApply={(edit) => applyExpressionEdit(edit, foreign.dependencies)}
            onClose={() => {
              setForeign(null);
              returnFocus();
            }}
          />
        )}
      </section>
    );
  },
  {
    op: 'ExpressionWorkspace'
  }
);
