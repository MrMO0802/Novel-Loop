import {
  validCanonPatch,
  validChapterMission,
  validCharacterState,
  validConfig,
  validDiagnosticsReport,
  validForeshadowing,
  validNarrativeDebt,
  validReaderState,
  validRevisionPlan,
  validSceneCard,
  validStoryState
} from './valid.js';

export const invalidConfig = {
  ...validConfig,
  qualityThreshold: 12
};

export const invalidStoryState = {
  ...validStoryState,
  latestCommittedChapter: -1
};

export const invalidCharacterState = {
  ...validCharacterState,
  role: 'mentor'
};

export const invalidNarrativeDebt = {
  ...validNarrativeDebt,
  importance: 11
};

export const invalidForeshadowing = {
  ...validForeshadowing,
  status: 'forgotten'
};

export const invalidReaderState = {
  ...validReaderState,
  readerKnows: '林澈买到了旧收音机'
};

export const invalidChapterMission = {
  ...validChapterMission,
  chapterNumber: 0
};

export const invalidSceneCard = {
  ...validSceneCard,
  beats: []
};

export const invalidDiagnosticsReport = {
  ...validDiagnosticsReport,
  scores: {
    ...validDiagnosticsReport.scores,
    total: 11
  }
};

export const invalidRevisionPlan = {
  ...validRevisionPlan,
  strategy: 'polish'
};

export const invalidCanonPatch = {
  ...validCanonPatch,
  narrativeDebtUpdates: [
    {
      debtId: 'debt_0001',
      action: 'erase',
      payload: {}
    }
  ]
};
