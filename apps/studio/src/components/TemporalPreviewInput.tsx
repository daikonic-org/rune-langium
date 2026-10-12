// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ReactElement } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { TemporalWireFormat } from '@rune-langium/codegen/export';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const TEMPORAL_INPUT_HELP: Record<TemporalWireFormat, string> = {
  date: 'Enter a calendar date, e.g. 2026-10-11.',
  time: 'Enter a time, e.g. 14:30:00. Fractional seconds are allowed.',
  dateTime: 'Enter a local date and time, e.g. 2026-10-11T14:30:00, without a UTC offset.',
  zonedDateTime:
    'Enter a date and time with an explicit offset, e.g. 2026-10-11T14:30:00+05:30. A timezone ID in brackets is optional.'
};

/** Pickers edit ISO strings; the worker remains the authoritative validator. */
export const TemporalPreviewInput = withInstrumentation(
  function TemporalPreviewInput({
    format,
    label,
    value,
    onChange,
    onBlur
  }: {
    format: TemporalWireFormat;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
  }): ReactElement {
    const [isoFormat, setIsoFormat] = useState<TemporalWireFormat | null>(null);
    if (isoFormat !== null && isoFormat !== format) setIsoFormat(null);
    const editIso = isoFormat === format;
    const zoned = format === 'zonedDateTime';
    // Split the presentation without interpreting or replacing the user's offset/zone.
    const zoneStart = zoned ? value.slice(10).search(/[Z+-]/) : -1;
    const local = zoneStart >= 0 ? value.slice(0, zoneStart + 10) : value;
    const suffix = zoneStart >= 0 ? value.slice(zoneStart + 10) : '';
    const fraction = local.split('.')[1];
    const exact = editIso || zoned || (fraction?.length ?? 0) > 3;
    const pickerType = format === 'date' ? 'date' : format === 'time' ? 'time' : 'datetime-local';
    const updatePicker = (picked: string) => {
      if (!picked) {
        onChange('');
        return;
      }
      try {
        let iso =
          format === 'date'
            ? Temporal.PlainDate.from(picked).toString()
            : format === 'time'
              ? Temporal.PlainTime.from(picked).toString()
              : Temporal.PlainDateTime.from(picked).toString();
        // Choosing another day/minute must not silently truncate existing exact subsecond data.
        const pickedFraction = iso.split('.')[1] ?? '';
        const displayedFraction = fraction?.slice(0, 3).replace(/0+$/, '');
        if (fraction && (!pickedFraction || pickedFraction === displayedFraction)) {
          iso = `${iso.split('.')[0]}.${fraction}`;
        }
        onChange(iso + suffix);
      } catch {
        onChange(picked + suffix);
      }
    };
    return (
      <>
        <Input
          aria-label={label}
          type={exact ? 'text' : pickerType}
          step="any"
          value={value}
          className="mt-0.5 h-7 text-xs"
          title={TEMPORAL_INPUT_HELP[format]}
          onChange={(event) => (exact ? onChange(event.target.value) : updatePicker(event.target.value))}
          onBlur={onBlur}
        />
        {exact ? (
          <Input
            aria-label={`${label} picker`}
            type={pickerType}
            step="any"
            value={fraction ? local.slice(0, local.indexOf('.') + 4) : local}
            className="mt-1 h-7 text-xs"
            onChange={(event) => updatePicker(event.target.value)}
            onBlur={onBlur}
          />
        ) : null}
        {zoned ? (
          <span className="mt-1 block text-2xs text-muted-foreground">
            Keep an explicit offset (Z or ±HH:MM); optionally append [Area/City].
          </span>
        ) : format !== 'date' ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => setIsoFormat(editIso ? null : format)}>
            {editIso ? 'Use picker' : 'Edit ISO value'}
          </Button>
        ) : null}
      </>
    );
  },
  { op: 'TemporalPreviewInput' }
);
