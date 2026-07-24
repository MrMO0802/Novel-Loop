import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultPrototypeState, type PrototypeState } from './prototypeState';

type SessionChapterDrafts = ReadonlyMap<string, string>;

export type ChapterRevisionDisposition = 'accepted' | 'alternate' | 'rejected';

export interface SessionChapterRevision {
  acceptedDraft: string;
  candidateDraft: string;
  disposition: ChapterRevisionDisposition;
  originalDraft: string;
}

type SessionChapterRevisions = ReadonlyMap<string, SessionChapterRevision>;

type PrototypeContextValue = {
  chapterDrafts: SessionChapterDrafts;
  chapterRevisions: SessionChapterRevisions;
  state: PrototypeState;
  decideChapterRevision: (
    chapterKey: string,
    disposition: ChapterRevisionDisposition,
    originalDraft: string,
    candidateDraft: string
  ) => void;
  updateAcceptedChapterDraft: (chapterKey: string, draft: string) => void;
  setChapterDraft: (chapterKey: string, draft: string) => void;
  setActiveProjectId: (projectId: string | null) => void;
  toggleFocusMode: () => void;
  setAssistantPanel: (assistantPanel: PrototypeState['assistantPanel']) => void;
  setActiveTaskId: (taskId: string | null) => void;
  setAutosave: (autosave: PrototypeState['autosave']) => void;
};

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

interface PrototypeContextProviderProps {
  children: ReactNode;
  initialState?: PrototypeState;
}

export function PrototypeContextProvider({ children, initialState }: PrototypeContextProviderProps) {
  const [state, setState] = useState<PrototypeState>(() => ({ ...defaultPrototypeState, ...initialState }));
  const [chapterRevisions, setChapterRevisions] = useState(
    () => new Map<string, SessionChapterRevision>()
  );
  const chapterDraftsRef = useRef(new Map<string, string>());

  const value = useMemo<PrototypeContextValue>(() => ({
    chapterDrafts: chapterDraftsRef.current,
    chapterRevisions,
    state,
    decideChapterRevision: (chapterKey, disposition, originalDraft, candidateDraft) => {
      setChapterRevisions((current) => {
        const next = new Map(current);
        next.set(chapterKey, {
          acceptedDraft: candidateDraft,
          candidateDraft,
          disposition,
          originalDraft
        });
        return next;
      });
    },
    updateAcceptedChapterDraft: (chapterKey, draft) => {
      setChapterRevisions((current) => {
        const revision = current.get(chapterKey);

        if (!revision) return current;

        const next = new Map(current);
        next.set(chapterKey, { ...revision, acceptedDraft: draft });
        return next;
      });
    },
    setChapterDraft: (chapterKey, draft) => {
      chapterDraftsRef.current.set(chapterKey, draft);
    },
    setActiveProjectId: (activeProjectId) => setState((current) => ({ ...current, activeProjectId })),
    toggleFocusMode: () => setState((current) => ({ ...current, focusMode: !current.focusMode })),
    setAssistantPanel: (assistantPanel) => setState((current) => ({ ...current, assistantPanel })),
    setActiveTaskId: (activeTaskId) => setState((current) => ({ ...current, activeTaskId })),
    setAutosave: (autosave) => setState((current) => ({ ...current, autosave }))
  }), [chapterRevisions, state]);

  return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
}

export function usePrototypeContext(): PrototypeContextValue {
  const context = useContext(PrototypeContext);

  if (!context) {
    throw new Error('PrototypeContextProvider is required.');
  }

  return context;
}
