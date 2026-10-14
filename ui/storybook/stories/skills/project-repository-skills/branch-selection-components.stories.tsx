import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RepositoryBranchSelect } from '@/components/RepositoryBranchSelect';
import { repositoryBranches } from '../../../support/skillSourceBranchSelection';

function BranchPicker({ state = 'ready', selected = '' }: { state?: 'ready' | 'loading' | 'error' | 'empty'; selected?: string }) {
  const [value, setValue] = useState(selected);
  const [retried, setRetried] = useState(false);
  return <div className="mx-auto max-w-md p-6">
    <RepositoryBranchSelect value={value} onChange={setValue} branches={state === 'empty' || state === 'loading' || (state === 'error' && !retried) ? [] : repositoryBranches}
      loading={state === 'loading'} error={state === 'error' && !retried ? 'Could not load branches from GitHub.' : null} onRetry={() => setRetried(true)} />
  </div>;
}
const meta = {
  id: 'skills-project-repository-skills-03-branch-selection-components',
  title: 'Agents and reusable capabilities/Skills and Skill Studio/Project repository skills/03 Branch selection components',
  component: BranchPicker,
  parameters: {
    layout: 'fullscreen',
    paperclip: { capabilities: ['skills/discovery', 'projects/repositories'], status: 'proposed', implementation: 'prototype', boundary: 'fixtures', notes: 'Proposed shared branch selector reuses the production SearchableSelect. Default, unlisted, loading, failed-list and long-name states. Branch discovery and saving are not connected to production APIs.' },
  },
} satisfies Meta<typeof BranchPicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SearchBranches: Story = {};
export const DefaultBranch: Story = { args: { selected: 'master' } };
export const UnlistedBranch: Story = { args: { selected: 'feature/my-new-workflow' } };
export const LoadingBranches: Story = { args: { state: 'loading' } };
export const BranchListUnavailable: Story = { args: { state: 'error' } };
export const NoBranches: Story = { args: { state: 'empty' } };
export const LongBranch: Story = { args: { selected: repositoryBranches[5]!.name } };
