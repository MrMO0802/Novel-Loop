export const IPC_CHANNELS = {
  systemGetReadiness: 'novel-loop:system:get-readiness',
  projectsList: 'novel-loop:projects:list',
  projectsChooseDefaultLibrary:
    'novel-loop:projects:choose-default-library',
  projectsCreate: 'novel-loop:projects:create',
  projectsOpenExisting: 'novel-loop:projects:open-existing',
  projectsOpen: 'novel-loop:projects:open',
  projectsRemove: 'novel-loop:projects:remove'
} as const;
