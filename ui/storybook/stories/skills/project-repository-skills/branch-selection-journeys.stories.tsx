import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SkillSource } from '@paperclipai/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import type { RepositoryBranch } from '@/components/RepositoryBranchSelect';
import { SkillSourceBranchRepairDialog } from '@/components/skill-studio/SkillSourceBranchRepairDialog';
import { SkillSources } from '@/pages/SkillSources';
import { PluginLauncherProvider } from '@/plugins/launchers';
import { Route, Routes, useNavigate } from '@/lib/router';
import { installBranchSelectionFixtures, type BranchSelectionScenario } from '../../../support/skillSourceBranchSelection';

function BranchSelectionJourney({ scenario = 'ready' }: { scenario?: BranchSelectionScenario }) {
  const client = useQueryClient(), navigate = useNavigate();
  const initialNavigate = useRef(navigate);
  const fixtures = useRef<ReturnType<typeof installBranchSelectionFixtures> | null>(null);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<SkillSource | null>(null);
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  useEffect(() => {
    const boundary = installBranchSelectionFixtures(scenario, client);
    fixtures.current = boundary;
    initialNavigate.current('/skills/sources', { replace: true });
    setSource(null); setBranches([]); setLoadError(null); setReady(true);
    return () => { loadRequest.current++; fixtures.current = null; boundary.cleanup(); };
  }, [client, scenario]);
  async function loadBranches() {
    const request = ++loadRequest.current;
    setLoading(true); setLoadError(null);
    try { const result = await fixtures.current!.branches(); if (request === loadRequest.current) setBranches(result); }
    catch (error) { if (request === loadRequest.current) setLoadError(error instanceof Error ? error.message : 'Could not load branches.'); }
    finally { if (request === loadRequest.current) setLoading(false); }
  }
  if (!ready) return null;
  return <PluginLauncherProvider>
    <Routes><Route path="/:companyPrefix" element={<Layout />}><Route path="skills/sources" element={<SkillSources onChooseBranch={selected => { setSource(selected); setBranches([]); void loadBranches(); }} />} /></Route></Routes>
    {source && <SkillSourceBranchRepairDialog key={source.id} repository={source.fullName} currentBranch={source.trackingRef}
      branches={branches} loading={loading} loadError={loadError} onRetry={() => void loadBranches()}
      onSave={branch => fixtures.current!.save(source.id, branch)} onClose={() => setSource(null)}
      onReturnFocus={() => document.querySelector<HTMLButtonElement>(`button[aria-label="More actions for ${CSS.escape(source.fullName)}"]`)?.focus()} />}
  </PluginLauncherProvider>;
}
const meta = {
  id: 'skills-project-repository-skills-04-branch-selection-journeys',
  title: 'Agents and reusable capabilities/Skills and Skill Studio/Project repository skills/04 Branch selection journeys',
  component: BranchSelectionJourney,
  tags: ['!autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Proposed branch repair in the production app shell and Sources page. Choose a new branch, search listed branches or enter any name, then Change branch. GitHub branch loading, validation and saving are in-memory simulations. In Validation failure, enter feature/missing, then recover by choosing master. Production retains its existing branch-repair behavior until the API and project-ref changes are implemented.' } },
    paperclip: { capabilities: ['skills/discovery', 'skills/versions', 'projects/repositories'], status: 'proposed', implementation: 'mixed', boundary: 'fixtures', notes: 'Production shell and Sources page with the proposed branch repair dialog. Default branch, search, unlisted input during loading/list failure, retry and validation failure. Saving is simulated and preserves fixture skill identities. Production branch APIs and project-workspace branch changes are not implemented by these stories.' },
  },
} satisfies Meta<typeof BranchSelectionJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ChooseBranch: Story = { name: 'Choose a listed or unlisted branch' };
export const SlowBranchList: Story = { name: 'Enter a name while branches load', args: { scenario: 'loading' } };
export const BranchListUnavailable: Story = { name: 'Use a name or retry when branch loading fails', args: { scenario: 'load-error' } };
export const EmptyBranchList: Story = { name: 'Enter a name with no listed branches', args: { scenario: 'empty' } };
export const ValidationFailure: Story = { name: 'Keep the selected branch after validation fails', args: { scenario: 'save-error' } };
export const ManyBranches: Story = { name: 'Search a large branch list', args: { scenario: 'many' } };
export const Mobile: Story = { globals: { viewport: { value: 'mobile1', isRotated: false } } };
export const Light: Story = { globals: { theme: 'light' } };
