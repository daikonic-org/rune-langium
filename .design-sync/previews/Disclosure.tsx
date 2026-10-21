// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import './_studio-dark';
import { Disclosure } from '@rune-langium/design-system';

export function AnnotationArguments() {
  return (
    <Disclosure label="Full annotation" open className="w-80 text-xs">
      <pre className="px-1 py-1.5">[metadata address]</pre>
    </Disclosure>
  );
}
