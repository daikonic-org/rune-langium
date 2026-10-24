// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { BuildConfigSchema } from '@rune-langium/project-config';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectInitializationReview } from '../../src/components/ProjectInitializationReview.js';
import type {
  GitHubInitializationSession,
  ReviewedMavenImportPreview
} from '../../src/workspace/project-initialization.js';
const preview: ReviewedMavenImportPreview = {
  build: BuildConfigSchema.parse({ schemaVersion: 1 }),
  report: [
    {
      code: 'NATIVE_UNAVAILABLE',
      status: 'unsupported',
      path: 'pom.xml',
      message: 'Java provider is unavailable',
      targets: ['java'],
      capabilities: ['java']
    }
  ],
  dependencies: [],
  provenance: { pomPath: 'pom.xml', profiles: [], documents: ['pom.xml'] },
  writes: [{ path: 'build-config.yml', text: 'schemaVersion: 1', expectedRevision: null }],
  preconditions: { paths: ['pom.xml'], inputs: [{ path: 'pom.xml', revision: 'captured' }] }
};
function session() {
  return {
    snapshot: {} as GitHubInitializationSession['snapshot'],
    prepare: vi.fn().mockResolvedValue(preview),
    save: vi.fn().mockResolvedValue({}),
    dispose: vi.fn()
  };
}
describe('inline GitHub initialization review', () => {
  it('shows proposed files and capability limitations before explicit Save', async () => {
    const current = session();
    render(<ProjectInitializationReview session={current} onContinue={vi.fn()} />);
    expect(await screen.findByText('build-config.yml')).toBeInTheDocument();
    expect(screen.getByText('Java provider is unavailable')).toBeInTheDocument();
    expect(current.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Initialize project settings' }));
    await waitFor(() => expect(current.save).toHaveBeenCalledWith(preview));
  });
  it('keeps browsing without saving and allows explicit profile review', async () => {
    const current = session();
    const onContinue = vi.fn();
    render(<ProjectInitializationReview session={current} onContinue={onContinue} />);
    await screen.findByText('build-config.yml');
    fireEvent.change(screen.getByLabelText('Profiles (optional)'), { target: { value: 'test, rates' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review profiles' }));
    await waitFor(() => expect(current.prepare).toHaveBeenLastCalledWith(['test', 'rates']));
    fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(current.save).not.toHaveBeenCalled();
  });
  it('retains the proposal on Save conflict and keeps the opened clone accessible', async () => {
    const current = session();
    current.save.mockRejectedValue(new Error('A project file changed. Review the working copy before retrying Save.'));
    const onContinue = vi.fn();
    render(<ProjectInitializationReview session={current} onContinue={onContinue} />);
    await screen.findByText('build-config.yml');
    fireEvent.click(screen.getByRole('button', { name: 'Initialize project settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('project file changed');
    expect(screen.getByText('build-config.yml')).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
  it('offers recovery after failed inspection without a false clone failure', async () => {
    const current = session();
    current.prepare.mockRejectedValueOnce(new Error('Read access unavailable'));
    render(<ProjectInitializationReview session={current} onContinue={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Read access unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Review profiles' }));
    expect(await screen.findByText('build-config.yml')).toBeInTheDocument();
  });
});
