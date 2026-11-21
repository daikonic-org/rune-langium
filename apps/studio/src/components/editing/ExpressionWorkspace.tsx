// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState, useRef, useId } from 'react';
import type { EditorView } from '@codemirror/view';
import type { ReactNode } from 'react';
import { useLatestRef, type ExpressionEditorSlotProps, type FunctionScope } from '@rune-langium/visual-editor';
import { nameFromNodeId, kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import {
  getFunctionImplementationRegion,
  getExpressionRegions,
  getExpressionRows,
  parseExpression,
  findExpressionOwner,
  type RosettaFunction,
  type Data,
  type Dehydrated,
  type SourceRegion,
  type ExpressionRegion,
  type ExpressionAddress,
  type ExpressionRow
} from '@rune-langium/core';
import type { WorkspaceFile, ParsedWorkspaceModel } from '../../services/workspace.js';
import { parseFile } from '../../services/workspace.js';
import {
  applyExpressionDocumentEdit,
  type DocumentBinding,
  type DocumentEdit,
  type ExpressionDocument
} from '../../services/expression-document.js';
import type { LspClientService } from '../../services/lsp-client.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { pathToUri } from '../../utils/uri.js';
import { ExpressionBuilderDialog } from './ExpressionBuilderDialog.js';
import { RuneRegionEditor } from './RuneRegionEditor.js';
import { GeneratedExpressionView } from './GeneratedExpressionView.js';
import { useExpressionProjection } from './use-expression-projection.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { protectedRegion } from '../../lang/document-extensions.js';
import { setExpressionHighlight } from '../../lang/source-navigation-highlight.js';
import { compositionExpressionEdit } from '../../services/composition-edit.js';
import { InlineExpressionRows } from './InlineExpressionRows.js';

// Condition editors in the same readonly file share its coordinate parse.
// Immutable file snapshots are weak keys, so changing source replaces the entry
// and unmounted files do not remain retained by this cache.
const originalSourceParses = new WeakMap<WorkspaceFile, ReturnType<typeof parseFile>>();
function originalSourceParse(file: WorkspaceFile): ReturnType<typeof parseFile> {
  let pending = originalSourceParses.get(file);
  if (!pending) {
    pending = parseFile(file.content, pathToUri(file.path));
    originalSourceParses.set(file, pending);
  }
  return pending;
}

export interface ExpressionWorkspaceProps {
  nodeId: string;
  file?: WorkspaceFile;
  parsed?: ParsedWorkspaceModel;
  documents: ExpressionDocument;
  parseCurrent: boolean;
  readOnly: boolean;
  onContentChange(path: string, fullSource: string): void;
  onOpenSource(): void;
  onOpenComposer?(target?: ExpressionAddress): void;
  inlineRune?: ReactNode;
  inlineCondition?: boolean;
  onEditingChange?: ExpressionEditorSlotProps['onEditingChange'];
  onRuneView?(view: EditorView): void;
  onRuneHover?(offset?: number): void;
  lspClient?: LspClientService;
  lspReady?: boolean;
  sourceError?: string;
  sourceOwner?: RosettaFunction | Data | Dehydrated<RosettaFunction> | Dehydrated<Data>;
  loadScope?: (region: SourceRegion) => Promise<FunctionScope>;
  target?: ExpressionEditorSlotProps['target'];
  dependencySnapshot?: readonly WorkspaceFile[];
}

type ConditionSnapshot = {
  binding: DocumentBinding;
  row: ExpressionRow;
  dependencies: readonly WorkspaceFile[];
};
const staleConditionMessage = 'The source changed. Discard this draft to reload the condition.';

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
    onOpenComposer,
    inlineRune,
    inlineCondition,
    onEditingChange,
    onRuneView,
    onRuneHover,
    lspClient,
    lspReady,
    sourceError,
    sourceOwner,
    loadScope,
    target,
    dependencySnapshot
  }: ExpressionWorkspaceProps) {
    const dependenciesRef = useLatestRef(dependencySnapshot);
    const [binding, setBinding] = useState<DocumentBinding | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [raw, setRaw] = useState(false);
    const [conditionDraft, setConditionDraft] = useState<ConditionSnapshot & { text: string }>();
    const [conditionScope, setConditionScope] = useState<FunctionScope>();
    const [conditionTyping, setConditionTyping] = useState<ConditionSnapshot>();
    const [conditionError, setConditionError] = useState<string>();
    const [conditionHover, setConditionHover] = useState<SourceRegion>();
    const conditionEditing = Boolean(conditionTyping || conditionDraft);
    useEffect(() => {
      onEditingChange?.(conditionEditing);
    }, [conditionEditing, onEditingChange]);
    useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
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
    const [sourceParse, setSourceParse] = useState<ParsedWorkspaceModel>();
    useEffect(() => {
      if (!file || file.sourceLoaded === false || !(file.readOnly || file.refOnly)) return;
      let cancelled = false;
      setBinding(null);
      setSourceParse(undefined);
      setCoordinateError('Resolving original source…');
      const failed = () => {
        if (!cancelled) setCoordinateError('The original source could not be parsed. Open the file in Source.');
      };
      void originalSourceParse(file)
        .then((result) => {
          if (cancelled) return;
          if (!result.model || result.errors.length) {
            failed();
            return;
          }
          setSourceParse({ filePath: file.path, source: file.content, model: result.model });
        })
        .catch(failed);
      return () => {
        cancelled = true;
      };
    }, [file?.path, file?.content, file?.sourceLoaded, file?.readOnly, file?.refOnly]);
    const regionKey = target ? `${target.kind}:${target.index}` : 'implementation';
    useEffect(() => {
      if (!file || file.sourceLoaded === false) return;
      const originalSource = file.readOnly || file.refOnly;
      if (originalSource && (sourceParse?.filePath !== file.path || sourceParse.source !== file.content)) return;
      const owner =
        originalSource && sourceParse
          ? findExpressionOwner(sourceParse.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) })
          : parsed && parseCurrent
            ? findExpressionOwner(parsed.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) })
            : readOnly && (file.readOnly || file.refOnly)
              ? sourceOwner
              : undefined;
      if (!owner || (owner.$type !== 'RosettaFunction' && owner.$type !== 'Data')) {
        if (parseCurrent) {
          setBinding(null);
          setCoordinateError('The selected declaration is no longer present in the current source.');
          return;
        }
        const recovered = documents.recoverRegion(pathToUri(file.path), nodeId, regionKey);
        if (recovered) {
          setBinding(recovered);
          setCoordinateError(undefined);
        } else setCoordinateError('Waiting for the changed declaration to parse…');
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
    }, [
      file,
      parsed,
      sourceParse,
      parseCurrent,
      sourceOwner,
      readOnly,
      nodeId,
      documents,
      target?.kind,
      target?.index
    ]);
    const originalSourceCurrent =
      !(file?.readOnly || file?.refOnly) ||
      (file.sourceLoaded !== false &&
        sourceParse?.filePath === file.path &&
        sourceParse.source === file.content &&
        binding?.source === file.content);
    const active =
      originalSourceCurrent &&
      file &&
      !coordinateError &&
      file.sourceLoaded !== false &&
      binding?.uri === pathToUri(file.path) &&
      binding.nodeId === nodeId
        ? binding
        : null;
    const displayed =
      originalSourceCurrent && file && binding?.uri === pathToUri(file.path) && binding.nodeId === nodeId
        ? binding
        : null;
    const sourceStatus =
      sourceError ??
      coordinateError ??
      (file?.sourceLoaded === false ? 'Loading source…' : 'Waiting for the current Rune source to parse…');
    const [language, setLanguage] = useState<'rune' | 'typescript' | 'python'>('rune');
    const [projectionRetry, setProjectionRetry] = useState(0);
    const projection = useExpressionProjection(
      language,
      active,
      Boolean(active && file && (readOnly || file.readOnly || (parseCurrent && parsed?.source === file.content))),
      target ? 'condition' : 'function',
      dependencySnapshot,
      projectionRetry
    );
    const captureTarget = () => {
      if (!active || !file || !parsed || !parseCurrent || readOnly || file.readOnly || active.readOnly) return;
      const owner = findExpressionOwner(parsed.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) });
      if (!owner || (owner.$type !== 'RosettaFunction' && owner.$type !== 'Data')) return;
      const entries = getExpressionRegions(owner);
      const expression = target
        ? entries.find((entry) => entry.kind === target.kind && entry.index === target.index)
        : (entries.find(
            (entry) => selection && entry.region.from <= selection.from && entry.region.to >= selection.to
          ) ?? (entries.length === 1 ? entries[0] : undefined));
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
    const applyExpressionEdit = (edit: DocumentEdit, dependencies: unknown) => {
      const view = viewRef.current;
      if (!view || dependenciesRef.current !== dependencies) return { ok: false as const, reason: 'stale' as const };
      return applyExpressionDocumentEdit(documents, view, edit);
    };
    const condition = (() => {
      if (!inlineCondition || !target || !active || !parsed || !parseCurrent || active.source !== parsed.source)
        return undefined;
      const owner = findExpressionOwner(parsed.model, { name: nameFromNodeId(nodeId), kind: kindFromNodeId(nodeId) });
      return owner && getExpressionRows(owner).find((row) => row.kind === target.kind && row.index === target.index);
    })();
    useEffect(() => {
      if (!inlineCondition || !condition || !loadScope) return;
      let cancelled = false;
      void loadScope(condition.region)
        .then((scope) => {
          if (!cancelled) setConditionScope(scope);
        })
        .catch(() => {
          /* Scope is also loaded on demand for individual slots. */
        });
      return () => {
        cancelled = true;
      };
    }, [inlineCondition, condition?.region.from, condition?.region.to, dependencySnapshot, loadScope]);
    const currentCondition =
      condition && active && dependencySnapshot
        ? { binding: active, row: condition, dependencies: dependencySnapshot }
        : undefined;
    const displayedCondition = conditionDraft ?? conditionTyping ?? currentCondition;
    const conditionStale =
      displayedCondition?.binding.revision !== currentCondition?.binding.revision ||
      displayedCondition?.dependencies !== currentCondition?.dependencies;
    const conditionEditable = Boolean(
      currentCondition && !conditionStale && !active?.readOnly && !readOnly && !file?.readOnly
    );
    const conditionMessage =
      conditionError ?? (conditionDraft && !conditionTyping && conditionStale ? staleConditionMessage : undefined);
    const conditionEditor = displayedCondition && file && (
      <InlineExpressionRows
        session={{
          binding: displayedCondition.binding,
          documents,
          file,
          files: displayedCondition.dependencies,
          scope: conditionScope
        }}
        rows={[displayedCondition.row]}
        draft={conditionDraft && { region: conditionDraft.row.region, text: conditionDraft.text }}
        pending={false}
        editable={conditionEditable}
        invalid={Boolean(conditionDraft && parseExpression(conditionDraft.text).hasErrors)}
        showStatement={false}
        onEditingChange={(editing) => setConditionTyping(editing ? displayedCondition : undefined)}
        onChange={(_, text) => {
          if (!conditionEditable) return;
          setConditionDraft({ ...displayedCondition, text });
          setConditionError(undefined);
        }}
        onApply={() => {
          if (!conditionDraft || conditionTyping || !conditionEditable) return;
          setConditionError(undefined);
          try {
            const { binding, row, text, dependencies } = conditionDraft;
            const edit = compositionExpressionEdit(binding, row.region, text);
            const result = applyExpressionEdit(edit, dependencies);
            if (!result.ok) throw new Error(staleConditionMessage);
            setConditionDraft(undefined);
          } catch (error) {
            setConditionError(error instanceof Error ? error.message : 'Could not apply this expression.');
          }
        }}
        onDiscard={() => {
          setConditionDraft(undefined);
          setConditionError(undefined);
        }}
        onHighlightRange={(range) => viewRef.current?.dispatch({ effects: setExpressionHighlight.of(range) })}
        highlightedRange={conditionHover}
        after={
          conditionMessage && (
            <p role="alert" className="text-xs text-destructive">
              {conditionMessage}
            </p>
          )
        }
      />
    );
    const inlineContent = inlineRune || (inlineCondition ? conditionEditor : undefined);
    const hoverRune =
      onRuneHover ??
      (inlineCondition
        ? (offset?: number) => setConditionHover(offset === undefined ? undefined : { from: offset, to: offset })
        : undefined);
    const projectionEdit =
      language === 'typescript' &&
      active &&
      !active.readOnly &&
      !readOnly &&
      !file?.readOnly &&
      parseCurrent &&
      projection.status === 'ready' &&
      projection.revision === active.revision &&
      projection.projection.syntax &&
      !projection.projection.implementation
        ? {
            capture: () => {
              if (!parsed || parsed.source !== active.source) return;
              const owner = findExpressionOwner(parsed.model, {
                name: nameFromNodeId(nodeId),
                kind: kindFromNodeId(nodeId)
              });
              if (!owner) return;
              const regions = getExpressionRegions(owner)
                .filter((entry) => entry.region.from >= active.region.from && entry.region.to <= active.region.to)
                .map((entry) => entry.region);
              const captured = documents.capture(active.uri, nodeId, active.region);
              if (!captured || captured.revision !== active.revision || !regions.length) return;
              return { binding: captured, regions, dependencies: dependencySnapshot };
            },
            apply: applyExpressionEdit
          }
        : undefined;
    const returnFocus = () => requestAnimationFrame(() => viewRef.current?.focus());
    return (
      <section
        id={editorId}
        data-expanded={expanded}
        className="expression-workspace flex shrink-0 flex-col gap-1"
        aria-label={target ? 'Condition expression' : 'Function implementation'}
      >
        <div className="flex min-h-6 shrink-0 flex-wrap items-center justify-between gap-1">
          {target && <span className="text-xs font-medium text-muted-foreground">Expression</span>}
          <div role="group" aria-label="Expression language" className="flex flex-wrap items-center gap-1">
            {(['rune', 'typescript', 'python'] as const).map((choice) => (
              <Button
                key={choice}
                variant="glass"
                size="xs"
                aria-pressed={language === choice}
                onClick={() => setLanguage(choice)}
              >
                {{ rune: 'Rune', typescript: 'TypeScript', python: 'Python' }[choice]}
              </Button>
            ))}
          </div>
          <div role="group" aria-label="Expression actions" className="flex flex-wrap items-center gap-1">
            {onOpenComposer && !target && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  const region = captureTarget()?.target.region;
                  onOpenComposer(region ? { root: region, range: region, path: '' } : undefined);
                }}
              >
                Open in Compose
              </Button>
            )}
            {inlineContent && language === 'rune' && (
              <Button size="xs" variant="ghost" aria-expanded={raw} onClick={() => setRaw(!raw)}>
                {raw ? 'Hide Rune text' : 'Edit Rune text'}
              </Button>
            )}
            {!inlineContent && !onOpenComposer && !inlineCondition && (
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
            )}
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
        <div
          aria-hidden={language !== 'rune' || Boolean(inlineContent && !raw)}
          className={language === 'rune' && (!inlineContent || raw) ? 'flex shrink-0 flex-col' : 'hidden'}
          onMouseMove={
            hoverRune
              ? (event) => hoverRune(viewRef.current?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined)
              : undefined
          }
          onMouseLeave={hoverRune ? () => hoverRune(undefined) : undefined}
        >
          {displayed && coordinateError && (
            <p role="status" className="text-xs text-muted-foreground">
              {coordinateError}
            </p>
          )}
          {displayed && file ? (
            <RuneRegionEditor
              binding={{ ...displayed, readOnly: !active || readOnly || Boolean(file.readOnly) || displayed.readOnly }}
              path={file.path}
              source={file.content}
              onContentChange={(path, source) => {
                if (!active) return;
                const region = viewRef.current?.state.field(protectedRegion, false);
                if (region) documents.retainRegion(active, regionKey, source, region);
                onContentChange(path, source);
              }}
              lspClient={lspClient}
              lspReady={lspReady}
              onViewCreated={(view) => {
                viewRef.current = view;
                onRuneView?.(view);
              }}
              onSelectionChange={(range) => setSelection(range)}
            />
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {sourceStatus}
            </p>
          )}
        </div>
        {inlineContent && <div hidden={language !== 'rune'}>{inlineContent}</div>}
        {language !== 'rune' && !originalSourceCurrent && (
          <p role="status" className="text-xs text-muted-foreground">
            {sourceStatus}
          </p>
        )}
        {language !== 'rune' && originalSourceCurrent && (
          <>
            <p className="shrink-0 text-xs text-muted-foreground">
              {projectionEdit ? 'Edit expressions in place · Apply to update Rune' : 'Generated · read-only'}
            </p>
            {'projection' in projection && projection.projection && (
              <GeneratedExpressionView
                key={`${displayed?.uri}:${nodeId}:${language}`}
                projection={projection.projection}
                edit={projectionEdit}
              />
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
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-xs text-destructive">
                  {projection.error}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setProjectionRetry((revision) => revision + 1)}
                >
                  Retry generation
                </Button>
              </div>
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
      </section>
    );
  },
  {
    op: 'ExpressionWorkspace'
  }
);
