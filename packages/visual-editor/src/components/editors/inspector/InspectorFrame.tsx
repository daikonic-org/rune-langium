// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@rune-langium/design-system/ui/tabs';

export interface InspectorSectionRequest {
  nodeId: string;
  sectionId: string;
  revision: number;
}

export const InspectorSectionRequestContext = createContext<InspectorSectionRequest | undefined>(undefined);

export interface InspectorSection {
  id: string;
  label: string;
  content: ReactNode;
  members?: boolean;
  fill?: boolean;
}
export interface InspectorFrameProps {
  header: ReactNode;
  inheritance?: ReactNode;
  sections: readonly InspectorSection[];
  details?: ReactNode;
  footer?: ReactNode;
  onSectionChange?: (id: string) => void;
}

/** Layout only: providers and editor sessions stay owned by their declaration. */
export function InspectorFrame({
  header,
  inheritance,
  sections,
  details,
  footer,
  onSectionChange
}: InspectorFrameProps) {
  const sectionRequest = useContext(InspectorSectionRequestContext);
  const [selected, setSelected] = useState(sectionRequest?.sectionId ?? sections[0]?.id);
  useEffect(() => {
    if (sectionRequest) setSelected(sectionRequest.sectionId);
  }, [sectionRequest]);
  const active = sections.find((section) => section.id === selected) ?? sections[0];
  const [mountedSections, setMountedSections] = useState(() => new Set<string>());
  // Track activation in state so discarded renders cannot retain an unvisited session.
  if (active && !mountedSections.has(active.id)) {
    setMountedSections(new Set(mountedSections).add(active.id));
  }
  return (
    <div data-slot="inspector-frame" className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="shrink-0">{header}</div>
      {inheritance && <div className="shrink-0 pb-1.5">{inheritance}</div>}
      {sections.length > 1 ? (
        <Tabs
          value={active?.id}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              setSelected(value);
              onSectionChange?.(value);
            }
          }}
          className={`flex flex-1 flex-col gap-1.5 ${active?.fill ? 'min-h-min' : 'min-h-0'}`}
        >
          <TabsList size="sm" className="h-auto w-full min-w-0 shrink-0 flex-wrap justify-start">
            {sections.map((section) => (
              <TabsTrigger key={section.id} value={section.id}>
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div data-slot="inspector-main" className="flex min-h-24 flex-1 flex-col">
            {sections.map((section) => (
              <TabsContent
                key={section.id}
                value={section.id}
                keepMounted={mountedSections.has(section.id)}
                className={`studio-scroll mt-0 flex-1 overflow-auto py-1.5 data-[hidden]:hidden ${section.fill ? 'flex min-h-min flex-col gap-1.5' : 'min-h-0'}`}
              >
                {section.content}
              </TabsContent>
            ))}
          </div>
          {active?.members ? details : null}
        </Tabs>
      ) : (
        <>
          <div data-slot="inspector-main" className="studio-scroll min-h-0 flex-1 overflow-auto py-1.5">
            {active?.content}
          </div>
          {active?.members ? details : null}
        </>
      )}
      {footer && (
        <footer data-slot="inspector-footer" className="shrink-0 border-t border-border pt-1.5">
          {footer}
        </footer>
      )}
    </div>
  );
}
