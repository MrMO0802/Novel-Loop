import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { defaultPrototypeState, type PrototypeState } from './prototypeState';

type PrototypeContextValue = {
  state: PrototypeState;
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

  const value = useMemo<PrototypeContextValue>(() => ({
    state,
    setActiveProjectId: (activeProjectId) => setState((current) => ({ ...current, activeProjectId })),
    toggleFocusMode: () => setState((current) => ({ ...current, focusMode: !current.focusMode })),
    setAssistantPanel: (assistantPanel) => setState((current) => ({ ...current, assistantPanel })),
    setActiveTaskId: (activeTaskId) => setState((current) => ({ ...current, activeTaskId })),
    setAutosave: (autosave) => setState((current) => ({ ...current, autosave }))
  }), [state]);

  return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
}

export function usePrototypeContext(): PrototypeContextValue {
  const context = useContext(PrototypeContext);

  if (!context) {
    throw new Error('PrototypeContextProvider is required.');
  }

  return context;
}
