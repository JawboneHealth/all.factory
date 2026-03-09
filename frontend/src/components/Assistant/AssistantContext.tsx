import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ScreenContext } from './useAssistant';

interface AssistantContextValue {
  context: Partial<ScreenContext>;
  setContext: (ctx: Partial<ScreenContext>) => void;
  mergeContext: (ctx: Partial<ScreenContext>) => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  context: {},
  setContext: () => {},
  mergeContext: () => {},
});

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<Partial<ScreenContext>>({});

  const setContext = useCallback((ctx: Partial<ScreenContext>) => {
    setContextState(ctx);
  }, []);

  const mergeContext = useCallback((ctx: Partial<ScreenContext>) => {
    setContextState(prev => ({ ...prev, ...ctx }));
  }, []);

  return (
    <AssistantContext.Provider value={{ context, setContext, mergeContext }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantContext() {
  return useContext(AssistantContext);
}
