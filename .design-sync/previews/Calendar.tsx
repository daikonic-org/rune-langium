// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import './_studio-dark';
import { useState } from 'react';
import { Calendar } from '@rune-langium/design-system';

// Form preview/prototype: the same calendar used inside the temporal field popover.
export function SettlementDate() {
  const [selected, setSelected] = useState<Date | undefined>(new Date(2026, 9, 20));
  return <Calendar mode="single" selected={selected} onSelect={setSelected} defaultMonth={new Date(2026, 9, 1)} />;
}
