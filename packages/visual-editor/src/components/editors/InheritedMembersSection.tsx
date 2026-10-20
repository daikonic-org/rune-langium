// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * InheritedMembersSection — Collapsible display of inherited members.
 *
 * Shows members from each ancestor in a collapsible group, ordered from
 * immediate parent to root. Used in DataTypeForm, EnumForm, and
 * FunctionForm to surface the full inherited interface.
 *
 * @module
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@rune-langium/design-system/ui/collapsible';
import { Badge } from '@rune-langium/design-system/ui/badge';
import type { InheritedGroup } from '../../hooks/useInheritedMembers.js';
import { TypeReferenceImports } from './TypeLink.js';
import { InheritedAttributeRow } from './AttributeRow.js';
import { getTypeRefText, formatCardinality } from '../../adapters/model-helpers.js';
import type { TypeOption } from '../../types.js';

export interface InheritedMembersSectionProps {
  /** Groups of inherited members, one per ancestor. */
  groups: InheritedGroup[];
  availableTypes?: TypeOption[];
  selectedKey?: string;
  onSelectMember?: (ancestor: string, name: string) => void;
}

export function InheritedMembersSection({
  groups,
  availableTypes,
  selectedKey,
  onSelectMember
}: InheritedMembersSectionProps) {
  if (groups.length === 0) return null;

  const totalCount = groups.reduce((sum, g) => sum + g.members.length, 0);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground px-1">Inherited ({totalCount})</p>
      {groups.map((group) => (
        <InheritedGroupCollapsible
          key={group.ancestorName}
          group={group}
          availableTypes={availableTypes}
          selectedKey={selectedKey}
          onSelectMember={onSelectMember}
        />
      ))}
    </div>
  );
}

function InheritedGroupCollapsible({
  group,
  availableTypes,
  selectedKey,
  onSelectMember
}: {
  group: InheritedGroup;
  availableTypes?: TypeOption[];
  selectedKey?: string;
  onSelectMember?: (ancestor: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-muted/50 transition-colors">
        <ChevronRight className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="font-medium text-muted-foreground">from {group.ancestorName}</span>
        <Badge variant="outline" className="ml-auto text-3xs h-4 px-1">
          {group.members.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <TypeReferenceImports.Provider value={group.imports}>
          <div className="ml-4 border-l border-border pl-2 space-y-0.5 py-1">
            {group.members.map((m) => {
              const member = m as Record<string, unknown>;
              const name = (member.name as string) ?? '';
              const typeName = getTypeRefText(member.typeCall as any);
              const cardinality = formatCardinality(member.card as any);
              return (
                <InheritedAttributeRow
                  availableTypes={availableTypes}
                  key={name}
                  name={name}
                  typeName={typeName ?? 'string'}
                  cardinality={cardinality}
                  ancestorName={group.ancestorName}
                  disabled
                  onOverride={() => {}}
                  selected={selectedKey === `inherited:${group.ancestorName}:${name}`}
                  onSelect={onSelectMember ? () => onSelectMember(group.ancestorName, name) : undefined}
                />
              );
            })}
          </div>
        </TypeReferenceImports.Provider>
      </CollapsibleContent>
    </Collapsible>
  );
}
