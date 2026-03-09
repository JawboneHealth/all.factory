import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ScreenContext {
  page: string;
  // Data Cleanup
  mmi_uploaded?: boolean;
  sql_uploaded?: boolean;
  analyzed?: boolean;
  total_changes?: number;
  pending_changes?: number;
  // Analytics
  analytics_view?: 'home' | 'upload' | 'results';
  analytics_tab?: string;
  analysis_name?: string;
  work_order?: string;
  station_count?: number;
  total_units?: number;
  total_errors?: number;
}

export function useAssistant(externalContext?: Partial<ScreenContext>) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const location = useLocation();

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const context: ScreenContext = {
      page: location.pathname,
      ...externalContext,
    };

    try {
      const res = await fetch(`${API_BASE}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages,
          context,
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Try again in a moment.",
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, location.pathname, externalContext]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, loading, sendMessage, clearMessages };
}
