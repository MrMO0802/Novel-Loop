import {
  acquireProjectOperationLease,
  type ProjectOperationLease
} from './projectOperationLease.js';

export type ProjectBuildLock = ProjectOperationLease;

export async function acquireProjectBuildLock(
  projectRoot: string
): Promise<ProjectBuildLock> {
  return acquireProjectOperationLease(projectRoot, {
    code: 'BUILD_BIBLE_LOCKED',
    message: 'Another Story Bible build is already running for this project.'
  });
}
