// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import './_studio-dark';
import { Input, Label } from '@rune-langium/design-system';

// J08 edit round-trip: filled inspector attribute-name field.
export const InlineAttributeName = () => (
  <div className="flex w-[320px] flex-col gap-1.5">
    <Label htmlFor="attr-name" className="text-muted-foreground">
      Attribute name
    </Label>
    <Input id="attr-name" className="h-7 px-2 font-mono text-xs" defaultValue="tradeDate" />
  </div>
);

// J05 inspector: empty namespace field with placeholder.
export const DefaultPlaceholder = () => (
  <div className="flex w-[320px] flex-col gap-1.5">
    <Label htmlFor="ns-name">Namespace</Label>
    <Input id="ns-name" placeholder="cdm.base.datetime" />
  </div>
);

// J12 import dialog: filled schema URL plus disabled target namespace.
export const FilledAndDisabled = () => (
  <div className="flex w-[320px] flex-col gap-3">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="src-url">Schema URL</Label>
      <Input id="src-url" defaultValue="https://api.example.com/openapi.json" />
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="src-ns">Target namespace</Label>
      <Input id="src-ns" disabled defaultValue="cdm.product.template" />
    </div>
  </div>
);

// J08 edit round-trip: invalid type name (aria-invalid).
export const Invalid = () => (
  <div className="flex w-[320px] flex-col gap-1.5">
    <Label htmlFor="type-name">Type name</Label>
    <Input id="type-name" aria-invalid="true" className="border-destructive" defaultValue="trade state" />
    <p className="text-xs text-destructive">Type names must be a single identifier, e.g. TradeState.</p>
  </div>
);
