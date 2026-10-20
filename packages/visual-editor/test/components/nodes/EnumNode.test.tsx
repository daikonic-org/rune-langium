// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { EnumNode } from '../../../src/components/nodes/EnumNode.js';
import { NavigationContext } from '../../../src/components/nodes/NavigationContext.js';
import { ENUM_PREVIEW_LIMIT } from '../../../src/utils/enum-preview.js';

for (const structure of [false, true]) {
  describe(`EnumNode ${structure ? 'Structure' : 'Graph'} preview`, () => {
    function show(count: number, onInspectType?: (id: string) => void) {
      const values = Array.from({ length: count }, (_, i) => `Value${i}`);
      const data = structure
        ? { id: 'demo.Status#RosettaEnumeration', name: 'Status', namespaceUri: 'demo', values, variant: 'structure' }
        : { $type: 'RosettaEnumeration', name: 'Status', enumValues: values.map((name) => ({ name })) };
      return render(
        <ReactFlowProvider>
          <NavigationContext.Provider
            value={{ allNodeIds: new Set(), layoutDirection: 'TB', pendingHydrationNamespaces: [], onInspectType }}
          >
            <EnumNode
              id={structure ? 'parent::Status' : 'demo.Status#RosettaEnumeration'}
              data={data as any}
              type="enum"
              selected={false}
            />
          </NavigationContext.Provider>
        </ReactFlowProvider>
      );
    }

    it('bounds long cards and reveals the canonical declaration without exposing hundreds of rows', () => {
      const inspect = vi.fn();
      show(500, inspect);
      expect(screen.getByText(`Value${ENUM_PREVIEW_LIMIT - 1}`)).toBeInTheDocument();
      expect(screen.queryByText(`Value${ENUM_PREVIEW_LIMIT}`)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'View all 500 values' }));
      expect(inspect).toHaveBeenCalledExactlyOnceWith('demo.Status#RosettaEnumeration');
    });

    it('keeps short and empty enums complete without a disclosure', () => {
      const host = show(ENUM_PREVIEW_LIMIT);
      expect(screen.getAllByText(/^Value\d+$/)).toHaveLength(ENUM_PREVIEW_LIMIT);
      expect(screen.queryByRole('button')).toBeNull();
      host.unmount();
      show(0);
      expect(screen.queryByText(/^Value\d+$/)).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows an honest remaining count when the host has no Inspector action', () => {
      show(20);
      expect(screen.getByText('12 more values')).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
}
