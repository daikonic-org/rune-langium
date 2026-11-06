// @instrumentation-codemod-applied

// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

/** Presentation-only effects. Canonical values, never DOM mutations, identify changes. */
export type ChangeEffect = 'add' | 'change' | 'remove';
export const CHANGE_HIGHLIGHT_MS = 900;
const CHANGE_ARRIVAL_MS = 280;
const CHANGE_DEPARTURE_MS = 180;
const CHANGE_REMOVAL_HOLD_MS = 160;
export const CHANGE_REMOVAL_MS = CHANGE_REMOVAL_HOLD_MS + CHANGE_DEPARTURE_MS;

export const installFeedbackTiming = withInstrumentation(
  function installFeedbackTiming(element: HTMLElement): void {
    for (const [name, duration] of Object.entries({
      highlight: CHANGE_HIGHLIGHT_MS,
      arrival: CHANGE_ARRIVAL_MS,
      departure: CHANGE_DEPARTURE_MS,
      hold: CHANGE_REMOVAL_HOLD_MS,
      removal: CHANGE_REMOVAL_MS
    }))
      element.style.setProperty(`--change-${name}-duration`, `${duration}ms`);
  },
  {
    op: 'installFeedbackTiming',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export interface FeedbackItem {
  key: string;
  group: string;
  value: string;
  selector: string;
  ordinal?: number;
}

export interface FeedbackRevision {
  sources: ReadonlyMap<string, string>;
  edits?: object;
  values?: object;
}

export const feedbackSources = withInstrumentation(
  function feedbackSources(
    files: readonly { path: string; content: string; readOnly?: boolean; refOnly?: boolean }[]
  ): ReadonlyMap<string, string> {
    return new Map(files.filter((file) => !file.readOnly && !file.refOnly).map((file) => [file.path, file.content]));
  },
  {
    op: 'feedbackSources',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const feedbackRevisionChanged = withInstrumentation(
  function feedbackRevisionChanged(before: FeedbackRevision | undefined, after: FeedbackRevision): boolean {
    if (!before) return false;
    return (
      Boolean(after.edits && after.edits !== before.edits) ||
      Boolean(after.values && after.values !== before.values) ||
      before.sources.size !== after.sources.size ||
      [...after.sources].some(([path, content]) => before.sources.get(path) !== content)
    );
  },
  {
    op: 'feedbackRevisionChanged',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export interface FeedbackChange {
  kind: ChangeEffect;
  before?: FeedbackItem;
  after?: FeedbackItem;
}

export const feedbackFingerprint = withInstrumentation(
  function feedbackFingerprint(value: unknown): string {
    return JSON.stringify(value, (key, item) => (key.startsWith('$') && key !== '$refText' ? undefined : item)) ?? '';
  },
  {
    op: 'feedbackFingerprint',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const feedbackSelector = withInstrumentation(
  function feedbackSelector(attribute: string, value: string): string {
    return `[${attribute}=${JSON.stringify(value)}]`;
  },
  {
    op: 'feedbackSelector',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const compareFeedbackItems = withInstrumentation(
  function compareFeedbackItems(before: readonly FeedbackItem[], after: readonly FeedbackItem[]): FeedbackChange[] {
    const oldByKey = new Map(before.map((item) => [item.key, item]));
    const newByKey = new Map(after.map((item) => [item.key, item]));
    const changes: FeedbackChange[] = [];
    const removed = before.filter((item) => !newByKey.has(item.key));
    const added = after.filter((item) => !oldByKey.has(item.key));
    for (const item of after) {
      const old = oldByKey.get(item.key);
      if (old && old.value !== item.value) changes.push({ kind: 'change', before: old, after: item });
    }
    const replacements = new Set<FeedbackItem>();
    for (const item of removed) {
      const oldGroup = removed.filter((candidate) => candidate.group === item.group);
      const newGroup = added.filter((candidate) => candidate.group === item.group);
      const replacement = oldGroup.length === 1 && newGroup.length === 1 ? newGroup[0] : undefined;
      if (replacement) {
        replacements.add(replacement);
        changes.push({ kind: 'change', before: item, after: replacement });
      } else changes.push({ kind: 'remove', before: item });
    }
    for (const item of added) {
      if (!replacements.has(item)) changes.push({ kind: 'add', after: item });
    }
    return changes;
  },
  {
    op: 'compareFeedbackItems',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

interface RenderedItem {
  item: FeedbackItem;
  element: HTMLElement;
  clone: HTMLElement;
  parent: HTMLElement | null;
  next: ChildNode | null;
  bounds: DOMRect;
  layoutWidth: number;
}

/** Owns ephemeral effects and inert removal snapshots, with no model or persistence writes. */
export class ChangeFeedbackBoundary {
  private root: HTMLElement | null = null;
  private scope: string | undefined;
  private items: readonly FeedbackItem[] | undefined;
  private rendered = new Map<string, RenderedItem[]>();
  private active = new Map<HTMLElement, () => void>();
  private locallyEdited = false;
  private revision: FeedbackRevision | undefined;

  private edited = (event: Event) => {
    // A later gesture in another surface supersedes a local gesture whose
    // values never changed these items (for example, editing a Form sample).
    this.locallyEdited = event.target instanceof Node && Boolean(this.root?.contains(event.target));
  };
  private clicked = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button'))
      this.locallyEdited = Boolean(this.root?.contains(event.target));
  };
  private focused = (event: FocusEvent) => {
    if (!(event.target instanceof Node)) return;
    for (const [element, clear] of this.active) {
      if (!element.hasAttribute('data-change-feedback-ghost') && element.contains(event.target)) clear();
    }
  };

  private attach(root: HTMLElement): void {
    if (root === this.root) return;
    this.detach();
    this.root = root;
    root.dataset.changeFeedbackBoundary = '';
    installFeedbackTiming(root);
    root.ownerDocument.addEventListener('input', this.edited, true);
    root.ownerDocument.addEventListener('change', this.edited, true);
    root.ownerDocument.addEventListener('click', this.clicked, true);
    root.addEventListener('focusin', this.focused);
  }

  private detach(): void {
    this.root?.ownerDocument.removeEventListener('input', this.edited, true);
    this.root?.ownerDocument.removeEventListener('change', this.edited, true);
    this.root?.ownerDocument.removeEventListener('click', this.clicked, true);
    this.root?.removeEventListener('focusin', this.focused);
    this.root = null;
  }

  clear(): void {
    for (const clear of this.active.values()) clear();
  }

  dispose(): void {
    this.clear();
    this.detach();
    this.items = undefined;
    this.rendered.clear();
    this.locallyEdited = false;
    this.revision = undefined;
  }

  private find(root: HTMLElement, selector: string): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(selector)].filter(
      (element) => !element.closest('[data-change-feedback-ghost]')
    );
  }

  private animate(element: HTMLElement, kind: ChangeEffect, remove?: () => void): void {
    this.active.get(element)?.();
    element.dataset.changeFeedback = kind;
    // Restart repeated feedback without replacing the actual control or its selection.
    element.style.animationName = 'none';
    void element.offsetWidth;
    element.style.removeProperty('animation-name');
    const clear = () => {
      clearTimeout(timeout);
      delete element.dataset.changeFeedback;
      this.active.delete(element);
      remove?.();
    };
    const timeout = setTimeout(clear, kind === 'remove' ? CHANGE_REMOVAL_MS : CHANGE_HIGHLIGHT_MS);
    this.active.set(element, clear);
  }

  private remove(root: HTMLElement, old: RenderedItem): void {
    const ghost = document.createElement('div');
    ghost.dataset.changeFeedbackGhost = '';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.setProperty('--change-removed-height', `${old.bounds.height}px`);
    const clone = old.clone;
    for (const element of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      element.removeAttribute('id');
      element.removeAttribute('autofocus');
      element.removeAttribute('data-change-feedback');
      element.removeAttribute('name');
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLButtonElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      )
        element.disabled = true;
    }
    ghost.append(clone);
    if (old.parent?.isConnected && root.contains(old.parent)) {
      old.parent.insertBefore(ghost, old.next?.parentNode === old.parent ? old.next : null);
    } else {
      // A form reset may replace the entire fieldset. Keep its ghost out of the new layout.
      const bounds = root.getBoundingClientRect();
      ghost.style.position = 'absolute';
      ghost.style.top = `${old.bounds.top - bounds.top + root.scrollTop}px`;
      ghost.style.left = `${old.bounds.left - bounds.left + root.scrollLeft}px`;
      ghost.style.width = `${old.bounds.width}px`;
      if (old.layoutWidth > 0 && old.bounds.width !== old.layoutWidth) {
        clone.style.transformOrigin = 'top left';
        clone.style.transform = `scale(${old.bounds.width / old.layoutWidth})`;
        clone.style.width = `${old.layoutWidth}px`;
      }
      root.append(ghost);
    }
    this.animate(ghost, 'remove', () => ghost.remove());
  }

  update(
    root: HTMLElement,
    scope: string,
    items: readonly FeedbackItem[],
    ready = true,
    revision?: FeedbackRevision
  ): void {
    const sameRoot = root === this.root;
    this.attach(root);
    if (scope !== this.scope) {
      this.clear();
      this.items = undefined;
      this.rendered.clear();
      this.locallyEdited = false;
      this.scope = scope;
      this.revision = revision;
    }
    if (!ready) return;
    if (sameRoot && this.items === items) return;
    const changes = this.items ? compareFeedbackItems(this.items, items) : [];
    const eligible = !revision || feedbackRevisionChanged(this.revision, revision);
    const quiet = this.locallyEdited || root.contains(document.activeElement);
    const removedAncestors: HTMLElement[] = [];
    for (const change of changes) {
      if (!eligible || quiet) continue;
      if (change.kind === 'remove' && change.before) {
        for (const old of this.rendered.get(change.before.key) ?? []) {
          if (removedAncestors.some((element) => element.contains(old.element))) continue;
          this.remove(root, old);
          removedAncestors.push(old.element);
        }
      } else if (change.after) {
        for (const element of this.find(root, change.after.selector)) {
          const ancestor = element.parentElement?.closest('[data-change-feedback="add"]');
          if (!element.contains(document.activeElement) && !ancestor) this.animate(element, change.kind);
        }
      }
    }
    if (changes.length) this.locallyEdited = false;
    const next = new Map<string, RenderedItem[]>();
    for (const item of items) {
      const rendered: RenderedItem[] = [];
      for (const element of this.find(root, item.selector)) {
        const previous = this.rendered.get(item.key)?.find((old) => old.element === element);
        const clone =
          previous?.element === element && previous.item.value === item.value
            ? previous.clone
            : element.cloneNode(true);
        if (!(clone instanceof HTMLElement)) continue;
        rendered.push({
          item,
          element,
          clone,
          parent: element.parentElement,
          next: element.nextSibling,
          bounds: element.getBoundingClientRect(),
          layoutWidth: element.offsetWidth
        });
      }
      if (rendered.length) next.set(item.key, rendered);
    }
    this.rendered = next;
    this.items = items;
    this.revision = revision;
  }
}
