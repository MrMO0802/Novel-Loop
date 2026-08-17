import {
  acquireProjectOperationLease,
  releaseManagedProjectOperationLease,
  type ProjectOperationLease
} from './projectOperationLease.js';

export type ProjectBuildLock = ProjectOperationLease;

export async function acquireProjectBuildLock(
  projectRoot: string
): Promise<ProjectBuildLock> {
  const lease = await acquireProjectOperationLease(projectRoot, {
    code: 'BUILD_BIBLE_LOCKED',
    message: 'Another Story Bible build is already running for this project.'
  });
  return {
    release: () => releaseManagedProjectOperationLease(projectRoot, lease)
  };
}
