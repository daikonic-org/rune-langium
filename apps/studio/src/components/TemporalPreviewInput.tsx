// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ReactElement, type FocusEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { CalendarDays, Clock3 } from 'lucide-react';
import type { TemporalWireFormat } from '@rune-langium/codegen/export';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import { Calendar } from '@rune-langium/design-system/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
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
    id,
    format,
    label,
    value,
    onChange,
    onBlur,
    'aria-invalid': invalid,
    'aria-describedby': describedBy
  }: {
    id?: string;
    format: TemporalWireFormat;
    label: string;
    value: string;
    onChange: (value: string, validate?: boolean) => void;
    onBlur: (event?: FocusEvent<HTMLElement>) => void;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }): ReactElement {
    const [isoFormat, setIsoFormat] = useState<TemporalWireFormat | null>(null);
    if (isoFormat !== null && isoFormat !== format) setIsoFormat(null);
    const [open, setOpen] = useState(false);
    const [timeDraft, setTimeDraft] = useState({ hour: '00', minute: '00', second: '00' });
    const zoned = format === 'zonedDateTime';
    // Split without interpreting or replacing the authored offset or timezone ID.
    const zoneStart = zoned ? value.slice(10).search(/[Z+-]/) : -1;
    const local = zoneStart >= 0 ? value.slice(0, zoneStart + 10) : value;
    const suffix = zoneStart >= 0 ? value.slice(zoneStart + 10) : '';
    const fraction = local.split('.')[1];
    const exact = isoFormat === format || zoned || (fraction?.length ?? 0) > 3;
    const pickerType = format === 'date' ? 'date' : format === 'time' ? 'time' : 'datetime-local';
    let selectedDay: Date | undefined;
    try {
      const date = Temporal.PlainDate.from(local.slice(0, 10));
      selectedDay = new Date(0);
      selectedDay.setFullYear(date.year, date.month - 1, date.day);
      selectedDay.setHours(0, 0, 0, 0);
    } catch {
      /* Empty or partial input is validated by the worker. */
    }
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
        const pickedFraction = iso.split('.')[1] ?? '';
        const displayedFraction = fraction?.slice(0, 3).replace(/0+$/, '');
        if (
          fraction &&
          (!pickedFraction || pickedFraction === displayedFraction || picked.split('.')[1] === fraction)
        ) {
          iso = `${iso.split('.')[0]}.${fraction}`;
        }
        onChange(iso + suffix, true);
      } catch {
        onChange(picked + suffix, true);
      }
    };
    const changeOpen = (next: boolean) => {
      if (next) {
        const parts = (format === 'time' ? local : (local.split('T')[1] ?? '')).split(':');
        setTimeDraft({ hour: parts[0] || '00', minute: parts[1] || '00', second: parts[2] || '00' });
      } else onBlur();
      setOpen(next);
    };
    return (
      <div className="preview-temporal">
        <div className="preview-temporal__control">
          <Input
            id={id}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            type={exact ? 'text' : pickerType}
            step="any"
            value={value}
            title={TEMPORAL_INPUT_HELP[format]}
            onChange={(event) => (exact ? onChange(event.target.value) : updatePicker(event.target.value))}
            onBlur={onBlur}
          />
          <Popover open={open} onOpenChange={changeOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-5"
                  aria-label={`Open ${label} picker`}
                  title={`Open ${label} picker`}
                />
              }
            >
              {format === 'time' ? (
                <Clock3 className="size-3.5" aria-hidden="true" />
              ) : (
                <CalendarDays className="size-3.5" aria-hidden="true" />
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="preview-temporal__picker w-72 p-0" aria-label={`${label} picker`}>
              {format !== 'time' && (
                <Calendar
                  mode="single"
                  className="w-full"
                  selected={selectedDay}
                  defaultMonth={selectedDay}
                  autoFocus
                  onSelect={(day) => {
                    if (!day) return;
                    const date = Temporal.PlainDate.from({
                      year: day.getFullYear(),
                      month: day.getMonth() + 1,
                      day: day.getDate()
                    }).toString();
                    updatePicker(format === 'date' ? date : `${date}T${local.split('T')[1] || '00:00:00'}`);
                    if (format === 'date') setOpen(false);
                  }}
                />
              )}
              {format !== 'date' && (
                <div className="preview-temporal__time">
                  <span className="text-xs font-medium">Time</span>
                  <div className="preview-temporal__segments">
                    {(['hour', 'minute', 'second'] as const).map((part) => (
                      <label key={part} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                        {part === 'hour' ? 'Hours' : part === 'minute' ? 'Minutes' : 'Seconds'}
                        <Input
                          aria-label={`${label} ${part}`}
                          inputMode={part === 'second' ? 'decimal' : 'numeric'}
                          value={timeDraft[part]}
                          onChange={(event) => setTimeDraft((current) => ({ ...current, [part]: event.target.value }))}
                          className="font-mono"
                        />
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const seconds = timeDraft.second.split('.');
                      seconds[0] = (seconds[0] ?? '').padStart(2, '0');
                      const time = `${timeDraft.hour.padStart(2, '0')}:${timeDraft.minute.padStart(2, '0')}:${seconds.join('.')}`;
                      updatePicker(
                        format === 'time'
                          ? time
                          : `${local.split('T')[0] || Temporal.Now.plainDateISO().toString()}T${time}`
                      );
                      setOpen(false);
                    }}
                  >
                    Set time
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {zoned ? (
          <span className="text-2xs text-muted-foreground">
            Keep an explicit offset (Z or ±HH:MM); optionally append [Area/City].
          </span>
        ) : format !== 'date' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="justify-self-start"
            onClick={() => setIsoFormat(isoFormat === format ? null : format)}
          >
            {isoFormat === format ? 'Use picker' : 'Edit ISO value'}
          </Button>
        ) : null}
      </div>
    );
  },
  { op: 'TemporalPreviewInput' }
);
