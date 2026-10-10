// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { EditorView } from '@codemirror/view';
import type { SourceRegion } from '@rune-langium/core';
import { SourceEditor } from '../SourceEditor.js';
import type { DocumentBinding } from '../../services/expression-document.js';
import type { LspClientService } from '../../services/lsp-client.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface RuneRegionEditorProps {
  binding: DocumentBinding;
  path: string;
  source: string;
  onContentChange(path: string, fullSource: string): void;
  lspClient?: LspClientService;
  lspReady?: boolean;
  onSelectionChange?: (selection: SourceRegion, view: EditorView) => void;
  onViewCreated?: (view: EditorView) => void;
}

export const RuneRegionEditor = withInstrumentation(
  function RuneRegionEditor({
    binding,
    path,
    source,
    onContentChange,
    lspClient,
    lspReady,
    onSelectionChange,
    onViewCreated
  }: RuneRegionEditorProps) {
    return (
      <div
        data-testid="implementation-editor"
        className="min-h-32 h-[var(--expression-editor-height,20rem)] resize-y overflow-hidden rounded-sm border border-border"
      >
        <SourceEditor
          files={[
            { name: path.split('/').pop() ?? path, path, content: source, dirty: false, readOnly: binding.readOnly }
          ]}
          activeFile={path}
          hideTabs
          region={binding.region}
          regionSource={binding.source}
          onContentChange={onContentChange}
          lspClient={lspClient}
          lspReady={lspReady}
          onSelectionChange={onSelectionChange}
          onEditorViewCreated={(_, view) => onViewCreated?.(view)}
        />
      </div>
    );
  },
  {
    op: 'RuneRegionEditor'
  }
);
