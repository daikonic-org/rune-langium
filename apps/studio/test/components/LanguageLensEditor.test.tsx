// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageLensEditor } from '../../src/components/LanguageLensEditor.js';
import { parseSourceTs, parsePy } from '@rune-langium/codegen/lens';
import { getPyWasmBytes } from '../../src/lens/py-wasm-asset.js';

// Real WASM fetch is exercised by ts-wasm-asset.test.ts (Step 1 of this
// task) and by parse-ts.test.ts's Node-path tests (Task 3) — this
// component test only needs SOME bytes to reach parseSourceTs, not a real
// network fetch, so it stubs the asset fetcher deterministically.
vi.mock('../../src/lens/ts-wasm-asset.js', () => ({
  getTsWasmBytes: vi.fn(async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('@vscode/tree-sitter-wasm/package.json');
    return new Uint8Array(readFileSync(pkgJsonPath.replace(/package\.json$/, 'wasm/tree-sitter-typescript.wasm')));
  })
}));

// Same deterministic-bytes strategy as ts-wasm-asset.js above, but wrapped
// in `vi.fn` (not a plain async function) so the WASM-fetch-failure test
// below can override it with `mockRejectedValueOnce` for a single call.
vi.mock('../../src/lens/py-wasm-asset.js', () => ({
  getPyWasmBytes: vi.fn(async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('@vscode/tree-sitter-wasm/package.json');
    return new Uint8Array(readFileSync(pkgJsonPath.replace(/package\.json$/, 'wasm/tree-sitter-python.wasm')));
  })
}));

// `parseSourceTs`/`parsePy` are wrapped in a `vi.fn` that calls through to the
// real implementation by default, so every other test still exercises the
// real tree-sitter parse-back path. The "parseSourceTs rejects" test below
// overrides `parseSourceTs` with `mockRejectedValueOnce` to simulate an internal
// web-tree-sitter/Parser.init() failure unrelated to the WASM fetch; the
// no-op-blur tests await `parseSourceTs`/`parsePy`'s recorded return promise
// directly to deterministically wait past the async blur handler's
// no-op-detection check (there's no DOM change to assert on for a no-op).
vi.mock('@rune-langium/codegen/lens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rune-langium/codegen/lens')>();
  return { ...actual, parseSourceTs: vi.fn(actual.parseSourceTs), parsePy: vi.fn(actual.parsePy) };
});

describe('LanguageLensEditor', () => {
  it('defaults to the Rune view', () => {
    render(<LanguageLensEditor value="value >= 0" onChange={vi.fn()} onBlur={vi.fn()} />);
    expect(screen.getByText('value >= 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /typescript/i })).toBeInTheDocument();
  });

  it('projects to TypeScript on toggle', async () => {
    render(<LanguageLensEditor value="currency exists" onChange={vi.fn()} onBlur={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    await waitFor(() => expect(screen.getByText('exists(currency)')).toBeInTheDocument());
  });

  it('commits a valid TS edit back as canonical Rune text via onChange', async () => {
    const onChange = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /typescript expression/i });
    fireEvent.input(editor, { target: { textContent: 'value > 0' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('value > 0'));
  });

  it('blocks commit and shows an inline error for out-of-subset TS, but still notifies onBlur', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /typescript expression/i });
    fireEvent.input(editor, { target: { textContent: 'value.toFixed(2)' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByText(/Rune source|Rune inverse/i)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    // A refusal is still a real DOM blur — upstream form state (touched/
    // validation) must see it even though nothing was committed.
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error, notifies onBlur, and does not commit when parseSourceTs rejects (thrown, not a refusal)', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    vi.mocked(parseSourceTs).mockRejectedValueOnce(new Error('boom — Parser.init() failure'));

    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /typescript expression/i });
    fireEvent.input(editor, { target: { textContent: 'value > 0' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows read-only Rune with a notice for expressions outside S, never a TS toggle result', () => {
    // 'items count' is outside S (RosettaCountOperation) — renderTs returns null.
    render(
      <LanguageLensEditor value="Point { x: value switch 1 then 2, default 3 }" onChange={vi.fn()} onBlur={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    expect(screen.getByText(/can.t be shown in typescript/i)).toBeInTheDocument();
    expect(screen.getByText('Point { x: value switch 1 then 2, default 3 }')).toBeInTheDocument();
  });

  it('skips onChange but still calls onBlur when blurring the TS lens without any edit', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const resultsBefore = vi.mocked(parseSourceTs).mock.results.length;
    const editor = screen.getByRole('textbox', { name: /typescript expression/i });
    fireEvent.blur(editor);

    // The blur handler still parses (it needs the resulting tree to compare
    // against the original) before deciding it's a no-op. Await the same
    // promise the handler itself awaits — the handler registered its
    // continuation on it first, so this deterministically waits past the
    // no-op check without relying on a DOM change (onChange not firing isn't
    // observable in the DOM; onBlur firing is asserted directly below).
    await waitFor(() => expect(vi.mocked(parseSourceTs).mock.results.length).toBeGreaterThan(resultsBefore));
    await vi.mocked(parseSourceTs).mock.results.at(-1)!.value;

    // onBlur is the slot's blur notification (marks the field touched /
    // triggers validation upstream, e.g. FunctionForm's `field.onBlur()`
    // composed into this same callback) — it must still fire even though
    // nothing changed, or upstream touched/validation state goes stale.
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Python-specific mirror of the TypeScript tests above — exercises the
  // SAME descriptor-table code paths (effect/blur handler) through the
  // 'python' entry in LENSES, proving the generalization in
  // LanguageLensEditor.tsx is genuinely shared, not per-language duplicated
  // logic. Uses the real renderPy/parsePy (see the `@rune-langium/codegen/lens`
  // mock above — only parseSourceTs is overridden with a vi.fn wrapper; parsePy
  // passes through to the actual implementation).
  it('projects to Python on toggle', async () => {
    render(<LanguageLensEditor value="currency exists" onChange={vi.fn()} onBlur={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    await waitFor(() => expect(screen.getByText('currency is not None')).toBeInTheDocument());
  });

  it('commits a valid Python edit back as canonical Rune text via onChange', async () => {
    const onChange = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /python expression/i });
    fireEvent.input(editor, { target: { textContent: 'value > 0' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('value > 0'));
  });

  it('blocks commit and shows an inline error for out-of-subset Python, but still notifies onBlur', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /python expression/i });
    // `not x` has no Rune equivalent (Rune has no unary boolean-negation
    // $type) — parsePy refuses it with a message containing "not supported".
    fireEvent.input(editor, { target: { textContent: 'not x' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByText(/not supported/i)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows an error message and still notifies onBlur when the Python WASM grammar fails to load', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    vi.mocked(getPyWasmBytes).mockRejectedValueOnce(new Error('network error'));

    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const editor = screen.getByRole('textbox', { name: /python expression/i });
    fireEvent.input(editor, { target: { textContent: 'value > 0' } });
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByText(/could not load the python parser/i)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    // A WASM-load failure is still a real DOM blur — the user tabbed away
    // from the field, so upstream form state must be notified even though
    // the lens itself couldn't parse anything.
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows read-only Rune with a notice for expressions outside S, never a Python toggle result', () => {
    // 'items count' is outside S (RosettaCountOperation) — renderPy returns
    // null too (same isInSubsetS gate as renderTs, see subset.ts).
    render(
      <LanguageLensEditor value="Point { x: value switch 1 then 2, default 3 }" onChange={vi.fn()} onBlur={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    expect(screen.getByText(/can.t be shown in python/i)).toBeInTheDocument();
    expect(screen.getByText('Point { x: value switch 1 then 2, default 3 }')).toBeInTheDocument();
  });

  it('skips onChange but still calls onBlur when blurring the Python lens without any edit', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<LanguageLensEditor value="value >= 0" onChange={onChange} onBlur={onBlur} />);
    fireEvent.click(screen.getByRole('button', { name: /python/i }));
    await waitFor(() => screen.getByText('value >= 0'));

    const resultsBefore = vi.mocked(parsePy).mock.results.length;
    const editor = screen.getByRole('textbox', { name: /python expression/i });
    fireEvent.blur(editor);

    await waitFor(() => expect(vi.mocked(parsePy).mock.results.length).toBeGreaterThan(resultsBefore));
    await vi.mocked(parsePy).mock.results.at(-1)!.value;

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
