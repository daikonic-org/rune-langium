// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { useDesignPreviewStore, type DesignPreviewPreference } from '../store/design-preview-store.js';
import './design-preferences-preview.css';

/** Temporary, opt-in comparison controls for the local design review. */
export default function DesignPreferencesPreview() {
  const { preferences, gap, setPreference, setGap, reset } = useDesignPreviewStore();
  const options: Array<{ key: DesignPreviewPreference; label: string }> = [
    { key: 'readable', label: '1 · Clearer navigation text' },
    { key: 'calm', label: '2 · Calmer chrome' },
    { key: 'auxiliary', label: '3 · Pinnable auxiliary panels' },
    { key: 'header', label: '4 · Uncrowd the top bar' },
    { key: 'details', label: '5 · Consistent controls' },
    { key: 'path', label: 'Explore location path' }
  ];

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.designPreviewCalm = String(preferences.calm);
    root.dataset.designPreviewReadable = String(preferences.readable);
    root.dataset.designPreviewHeader = String(preferences.header);
    root.dataset.designPreviewDetails = String(preferences.details);
    root.dataset.designPreviewGap = gap;
    return () => {
      delete root.dataset.designPreviewCalm;
      delete root.dataset.designPreviewReadable;
      delete root.dataset.designPreviewHeader;
      delete root.dataset.designPreviewDetails;
      delete root.dataset.designPreviewGap;
    };
  }, [preferences, gap]);

  useEffect(() => () => reset(), [reset]);

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
          {options.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <Checkbox checked={preferences[key]} onCheckedChange={(checked) => setPreference(key, checked)} />
              {label}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Auxiliary panels start pinned. Unpin to collapse them into edge tabs. Open panels can stay alongside each
            other; unpinned panels hide when you return to the main work area. Turning this off restores your original
            arrangement.
          </p>
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
          <Button variant="secondary" size="sm" onClick={reset}>
            Reset to current design
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
