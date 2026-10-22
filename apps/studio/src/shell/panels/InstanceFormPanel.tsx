// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { FormPreviewPanel } from '../../components/FormPreviewPanel.js';
import { useInstanceStore } from '../../store/instance-store.js';
import type { PreviewStatus } from '../../store/preview-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface InstanceFormPanelProps {
  instanceId: string;
  onNewInstance?(): void;
}

export const InstanceFormPanel = withInstrumentation(
  function InstanceFormPanel({ instanceId, onNewInstance }: InstanceFormPanelProps): ReactElement {
    const record = useInstanceStore((s) => s.instances[instanceId]);
    const schema = useInstanceStore((s) => (record ? s.schemas.get(record.typeFqn) : undefined));
    const schemaError = useInstanceStore((s) => (record ? s.schemaErrors.get(record.typeFqn) : undefined));
    const updateInstanceData = useInstanceStore((s) => s.updateInstanceData);
    const rawDiagnostics = useInstanceStore((s) => s.validationErrors[instanceId]);
    const validationStatus = useInstanceStore((s) => s.validationStatus[instanceId]);
    const prepareInstance = useInstanceStore((s) => s.prepareInstance);
    const retryInstance = useInstanceStore((s) => s.retryInstance);

    useEffect(() => {
      if (!record) return;
      void prepareInstance(record.id);
      // Only re-dispatch when the target type changes, not on every store
      // update (updateInstanceData/receiveValidateResult also touch this
      // store and must not retrigger a schema fetch).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id, record?.typeFqn, prepareInstance]);

    if (!record) {
      return (
        <section role="status" className="p-3 text-sm text-muted-foreground">
          Instance not found.
        </section>
      );
    }

    // A failed schema fetch (finding #7) renders as 'unavailable' — reusing
    // FormPreviewPanel's existing status contract — instead of leaving the
    // panel stuck on "Generating preview…" forever.
    const status: PreviewStatus = schema
      ? { state: 'ready', targetId: record.typeFqn }
      : schemaError
        ? { state: 'unavailable', targetId: record.typeFqn, reason: schemaError.reason, message: schemaError.message }
        : { state: 'waiting', targetId: record.typeFqn };

    // `undefined` means no instance:validateResult has arrived yet for this
    // instance (e.g. it was just created and the round trip is still in
    // flight) — treat as "nothing to show yet", matching the uncontrolled
    // panel's own pre-first-validation convention, rather than surfacing a
    // stale/empty result as either "all valid" or "all invalid".
    const { errors, valid, validated } =
      rawDiagnostics && validationStatus !== 'pending'
        ? {
            errors: Object.fromEntries(rawDiagnostics.map((d) => [d.path, d.message])),
            valid: rawDiagnostics.length === 0,
            validated: true
          }
        : { errors: {}, valid: false, validated: false };

    const newInstanceAction = onNewInstance ? (
      <Button type="button" variant="ghost" size="xs" onClick={onNewInstance}>
        New…
      </Button>
    ) : undefined;
    if (validationStatus === 'unavailable') {
      return (
        <section className="space-y-3 p-3 text-sm text-muted-foreground">
          {newInstanceAction}
          <p>{schemaError?.message ?? 'Instance validation is unavailable.'}</p>
          <button type="button" className="rounded border px-2 py-1" onClick={() => void retryInstance(instanceId)}>
            Retry
          </button>
        </section>
      );
    }

    return (
      <FormPreviewPanel
        layoutToolbarStart={newInstanceAction}
        schema={schema}
        status={status}
        values={record.data as Record<string, unknown>}
        onValuesChange={(values) => updateInstanceData(instanceId, values)}
        errors={errors}
        valid={valid}
        validated={validated}
        presentation={{ mode: 'instance', showPayload: false, showHeader: false }}
      />
    );
  },
  { op: 'InstanceFormPanel' }
);
