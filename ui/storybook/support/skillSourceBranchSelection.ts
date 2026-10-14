import type { QueryClient } from '@tanstack/react-query';
import { skillSourcesApi } from '@/api/skillSources';
import type { RepositoryBranch } from '@/components/RepositoryBranchSelect';
import { queryKeys } from '@/lib/queryKeys';
import { installProjectSkillFixtures } from './projectRepositorySkills';
import { COMPANY_ID } from '../fixtures/githubSkillSources';

export const repositoryBranches: RepositoryBranch[] = [
  { name: 'master', isDefault: true },
  { name: 'develop' },
  { name: 'release/2026.10' },
  { name: 'feature/project-skills' },
  { name: 'feature/branch-selection' },
  { name: 'feature/platform-services-repository-skill-refresh-and-accessibility-improvements' },
];
export type BranchSelectionScenario = 'ready' | 'loading' | 'load-error' | 'empty' | 'save-error' | 'many';

/** Proposed branch API boundary. No network requests or production mutations. */
export function installBranchSelectionFixtures(scenario: BranchSelectionScenario, client: QueryClient) {
  const cleanup = installProjectSkillFixtures('missing-branch', client);
  const originalList = skillSourcesApi.list;
  const selections = new Map<string, string>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const delay = (milliseconds: number) => new Promise<void>(resolve => { timers.push(setTimeout(resolve, milliseconds)); });
  let attempts = 0;
  skillSourcesApi.list = async companyId => (await originalList(companyId)).map(source => {
    const branch = selections.get(source.id);
    return branch === undefined ? { ...source, lastError: 'The tracked branch is unavailable. Choose a new branch.' }
      : { ...source, trackingRef: branch, lastError: null, repairAction: null, syncState: 'ready', revision: source.revision + 1 };
  });
  return {
    async branches() {
      await delay(scenario === 'loading' ? 4000 : 350);
      if (scenario === 'load-error' && attempts++ === 0) throw new Error('Could not load branches from GitHub.');
      return scenario === 'empty' ? [] : scenario === 'many'
        ? [...repositoryBranches, ...Array.from({ length: 80 }, (_, index) => ({ name: `feature/workflow-${index + 1}` }))]
        : repositoryBranches;
    },
    async save(sourceId: string, branch: string) {
      await delay(900);
      if (scenario === 'save-error' && branch === 'feature/missing') throw new Error('GitHub could not find “feature/missing”. Check the name or choose another branch.');
      selections.set(sourceId, branch);
      await client.invalidateQueries({ queryKey: queryKeys.skillSources.all(COMPANY_ID) });
    },
    cleanup() { timers.forEach(clearTimeout); skillSourcesApi.list = originalList; cleanup(); },
  };
}
