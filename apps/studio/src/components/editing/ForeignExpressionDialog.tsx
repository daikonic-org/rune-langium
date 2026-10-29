// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef, useState } from 'react';
import { parseExpression, type SourceRegion } from '@rune-langium/core';
import { RosettaExpressionSchema } from '@rune-langium/core/zod-schemas';
import { renderExpression, treesEquivalent } from '@rune-langium/codegen/rosetta';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@rune-langium/design-system/ui/dialog';
import { Button } from '@rune-langium/design-system/ui/button';
import { FOREIGN_LENSES, expressionOrigin } from '../../lens/lens-descriptors.js';
import type { DocumentBinding, DocumentEdit, CommitResult } from '../../services/expression-document.js';
import { ExpressionCodeEditor } from './ExpressionCodeEditor.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

interface ForeignDialogProps {
  binding: DocumentBinding;
  region: SourceRegion;
  language: keyof typeof FOREIGN_LENSES;
  onApply(edit: DocumentEdit): CommitResult;
  onClose(): void;
}
export const ForeignExpressionDialog = withInstrumentation(
  function ForeignExpressionDialog({ binding, region, language, onApply, onClose }: ForeignDialogProps) {
    const expectedText = binding.source.slice(region.from, region.to);
    const original = parseExpression(expectedText);
    const descriptor = FOREIGN_LENSES[language];
    const initial = original.hasErrors ? null : descriptor.render(original.value);
    const [draft, setDraft] = useState(initial ?? '');
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    const close = () => {
      mounted.current = false;
      onClose();
    };
    const apply = async () => {
      if (binding.readOnly || pending || initial === null) return;
      setPending(true);
      try {
        const parsed = await descriptor.parse(
          draft,
          await descriptor.getWasmBytes(),
          original.hasErrors ? undefined : expressionOrigin(language, original.value)
        );
        if (!mounted.current) return;
        if (!parsed.ok) {
          setError(parsed.reason.message);
          return;
        }
        const validated = RosettaExpressionSchema.safeParse(parsed.node);
        if (!validated.success) {
          setError('The parsed expression is not a valid Rune AST.');
          return;
        }
        const unchanged = !original.hasErrors && treesEquivalent(original.value, parsed.node);
        const replacement = unchanged ? expectedText : renderExpression(parsed.node);
        if (parseExpression(replacement).hasErrors) {
          setError('The draft does not produce valid Rune source.');
          return;
        }
        const committed = onApply({ binding, region, expectedText, replacement });
        if (committed.ok) close();
        else
          setError(
            committed.reason === 'read-only' ? 'This source is read-only.' : 'The source changed. Reopen the dialog.'
          );
      } catch (error) {
        if (mounted.current) setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted.current) setPending(false);
      }
    };
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="w-[calc(100vw-32px)] max-w-[900px] max-h-[calc(100dvh-32px)] gap-3 overflow-auto p-4">
          <DialogTitle className="text-sm">Edit expression as {descriptor.label}</DialogTitle>
          <DialogDescription className="text-xs">
            Only reversible expressions can be applied. This draft replaces one captured Rune expression.
          </DialogDescription>
          {initial === null ? (
            <p role="alert">Reverse editing is not available for this expression. Edit its Rune source.</p>
          ) : (
            <ExpressionCodeEditor
              code={draft}
              language={language}
              label={`${descriptor.label} expression draft`}
              readOnly={binding.readOnly}
              onChange={setDraft}
            />
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" disabled={binding.readOnly || initial === null || pending} onClick={apply}>
              {pending ? 'Checking…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
  { op: 'ForeignExpressionDialog' }
);
