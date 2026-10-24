// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from '../services/instrumentation/core.js';
import { TARGET_OPTIONS_SCHEMAS } from '@rune-langium/codegen/export';
import { ExportSelect } from './ExportSelect.js';

const fields = { dialect: 'Dialect', inheritance: 'Inheritance', enumStrategy: 'Enum strategy' } as const;
/** Owner schemas supply values; Studio supplies only presentation labels. */
export const SqlOptionsForm = withInstrumentation(
  function SqlOptionsForm({
    value,
    onChange
  }: {
    value: Record<string, unknown>;
    onChange(value: Record<string, unknown>): void;
  }) {
    return (
      <div className="flex flex-col gap-2">
        {(Object.keys(fields) as (keyof typeof fields)[]).map((field) => (
          <label key={field} className="flex flex-col gap-1 text-xs font-medium">
            {fields[field]}
            <ExportSelect
              aria-label={fields[field]}
              value={typeof value[field] === 'string' ? value[field] : ''}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value) next[field] = event.target.value;
                else delete next[field];
                onChange(next);
              }}
            >
              <option value="">Generator default</option>
              {TARGET_OPTIONS_SCHEMAS.sql.shape[field].unwrap().options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </ExportSelect>
          </label>
        ))}
      </div>
    );
  },
  { op: 'SqlOptionsForm' }
);
