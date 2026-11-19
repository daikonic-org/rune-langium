// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Component tests for CodegenTargetsTable (018 Phase 0 Task 0.7).
 *
 * The table is pure props — no zustand mocks needed. Each test verifies a
 * single behavior so a future regression points squarely at the broken
 * piece.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IMPLEMENTED_TARGETS, TARGET_DESCRIPTORS, type Target } from '@rune-langium/codegen/export';
import { CodegenTargetsTable } from '../../src/components/CodegenTargetsTable.js';

afterEach(() => cleanup());

// 018 Task 0.7 follow-up — the table filters by IMPLEMENTED_TARGETS, so
// the assertions below talk in terms of "rows we expect to see" rather
// than "every target in the registry."
const IMPLEMENTED = IMPLEMENTED_TARGETS as readonly Target[];
const NOT_IMPLEMENTED = (Object.keys(TARGET_DESCRIPTORS) as Target[]).filter((t) => !IMPLEMENTED.includes(t));
const NAMESPACE_TARGETS = IMPLEMENTED.filter((t) => TARGET_DESCRIPTORS[t].contract === 'namespace');
const DOWNLOAD_ONLY_TARGETS = IMPLEMENTED.filter(
  (t) => TARGET_DESCRIPTORS[t].contract === 'whole-model' && t !== 'python'
);

describe('CodegenTargetsTable', () => {
  it('renders one row per implemented target with its label', () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} />);
    for (const target of IMPLEMENTED) {
      const row = screen.getByTestId(`codegen-targets-table__row-${target}`);
      expect(row).toBeTruthy();
      const descriptor = TARGET_DESCRIPTORS[target];
      expect(row.textContent).toContain(descriptor.label);
    }
  });

  it('exposes accessible button names via aria-label so screen readers still announce View / Download', () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} />);
    // Sample one namespace target and verify both labels are present.
    const viewBtn = screen.getByTestId('codegen-targets-table__view-zod');
    const downloadBtn = screen.getByTestId('codegen-targets-table__download-zod');
    expect(viewBtn.getAttribute('aria-label')).toMatch(/View Zod/);
    expect(downloadBtn.getAttribute('aria-label')).toMatch(/Download Zod/);
  });

  it('does not render rows for targets without a registered emitter', () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} />);
    for (const target of NOT_IMPLEMENTED) {
      expect(screen.queryByTestId(`codegen-targets-table__row-${target}`)).toBeNull();
    }
  });

  it('shows [View] + [Download] for namespace-contract targets', () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} />);
    for (const target of NAMESPACE_TARGETS) {
      expect(screen.getByTestId(`codegen-targets-table__view-${target}`)).toBeTruthy();
      expect(screen.getByTestId(`codegen-targets-table__download-${target}`)).toBeTruthy();
    }
  });

  // Phase 0 ships only namespace-contract emitters, so this test is a
  // no-op skip until Phase 3 lands graphql / Phase 1 lands excel. Once
  // either does, IMPLEMENTED_TARGETS will start including a whole-model
  // entry and this test will run and exercise it.
  it.skipIf(DOWNLOAD_ONLY_TARGETS.length === 0)('shows [Download] only for targets without a preview', () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} />);
    for (const target of DOWNLOAD_ONLY_TARGETS) {
      expect(screen.queryByTestId(`codegen-targets-table__view-${target}`)).toBeNull();
      expect(screen.getByTestId(`codegen-targets-table__download-${target}`)).toBeTruthy();
    }
  });

  it('invokes onView with the target id when [View] is clicked', () => {
    const onView = vi.fn();
    render(<CodegenTargetsTable onView={onView} onDownload={vi.fn()} />);
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-zod'));
    expect(onView).toHaveBeenCalledWith('zod');
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-python'));
    expect(onView).toHaveBeenCalledWith('python');
  });

  it('invokes onDownload with the target id when [Download] is clicked', () => {
    const onDownload = vi.fn();
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={onDownload} />);
    // Use an implemented namespace target so the row actually renders;
    // pre-filter, this test used 'excel' which is no longer in the table.
    fireEvent.click(screen.getByTestId('codegen-targets-table__download-zod'));
    expect(onDownload).toHaveBeenCalledWith('zod');
  });

  it("replaces a row's buttons with a spinner when inflightTarget matches", () => {
    render(<CodegenTargetsTable onView={vi.fn()} onDownload={vi.fn()} inflightTarget="typescript" />);
    expect(screen.getByTestId('codegen-targets-table__spinner-typescript')).toBeTruthy();
    expect(screen.queryByTestId('codegen-targets-table__view-typescript')).toBeNull();
    expect(screen.queryByTestId('codegen-targets-table__download-typescript')).toBeNull();
  });

  it('only shows the spinner on the in-flight row; other rows remain interactive', () => {
    const onView = vi.fn();
    render(<CodegenTargetsTable onView={onView} onDownload={vi.fn()} inflightTarget="zod" />);
    // zod's spinner shown
    expect(screen.getByTestId('codegen-targets-table__spinner-zod')).toBeTruthy();
    // typescript's row is untouched
    fireEvent.click(screen.getByTestId('codegen-targets-table__view-typescript'));
    expect(onView).toHaveBeenCalledWith('typescript');
  });
});
