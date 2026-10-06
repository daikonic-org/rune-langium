// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import './design-preferences-preview.css';

/** Temporary, opt-in comparison controls for the local design review. */
export default function DesignPreferencesPreview() {
  const [calm, setCalm] = useState(false);
  const [readable, setReadable] = useState(false);
  const [gap, setGap] = useState('current');

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.designPreviewCalm = String(calm);
    root.dataset.designPreviewReadable = String(readable);
    root.dataset.designPreviewGap = gap;
    return () => {
      delete root.dataset.designPreviewCalm;
      delete root.dataset.designPreviewReadable;
      delete root.dataset.designPreviewGap;
    };
  }, [calm, readable, gap]);

  return (
    <div className="fixed bottom-9 right-4 z-[80]">
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <SlidersHorizontal className="size-3.5" />
          Design preferences
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Compare the design</h2>
            <p className="text-xs text-muted-foreground">Changes apply live. Reload to return to the current design.</p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={calm} onCheckedChange={setCalm} />
            Calmer chrome
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={readable} onCheckedChange={setReadable} />
            Clearer navigation text
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Pane pill gap
            <select
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            >
              <option value="compact">None</option>
              <option value="current">Current (16px)</option>
              <option value="wide">Wider (24px)</option>
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCalm(false);
              setReadable(false);
              setGap('current');
            }}
          >
            Reset to current design
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
