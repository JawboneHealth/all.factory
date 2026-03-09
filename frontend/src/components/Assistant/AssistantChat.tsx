import { useState, useEffect, useRef } from 'react';
import { Send, Minimize2, MessageCircle, RotateCcw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAssistant, type Message } from './useAssistant';
import { useAssistantContext } from './AssistantContext';
import './AssistantChat.css';

interface Props {}

const SUGGESTIONS: Record<string, string[]> = {
  '/': [
    'What does this app do?',
    'Which tool should I use?',
    'How do I get started?',
  ],
  '/data-cleanup': [
    'What files do I need to upload?',
    'What kinds of issues does this detect?',
    'How do I export the cleaned data?',
  ],
  '/analytics': [
    'How do I start a new analysis?',
    'What does the Dashboard tab show?',
    'How do I read the Error Timeline?',
    'What are cross-station cascades?',
  ],
};

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`assistant-msg ${isUser ? 'user' : 'bot'}`}>
      {!isUser && <div className="bot-avatar">af</div>}
      <div className="msg-bubble">
        {isUser ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
      </div>
    </div>
  );
}

export function AssistantChat({}: Props) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const { context } = useAssistantContext();
  const { messages, loading, sendMessage, clearMessages } = useAssistant(context);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const page = window.location.pathname;
  const suggestions = SUGGESTIONS[page] || SUGGESTIONS['/'];

  useEffect(() => {
    if (open && !minimized) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, minimized]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        className={`assistant-fab ${open ? 'open' : ''}`}
        onClick={() => { setOpen(o => !o); setMinimized(false); }}
        title="all.factory assistant"
      >
        <MessageCircle size={20} />
      </button>

      {/* Chat panel */}
      {open && (
        <div className={`assistant-panel ${minimized ? 'minimized' : ''}`}>
          {/* Header */}
          <div className="assistant-header">
            <div className="assistant-header-left">
              <div className="assistant-avatar">af</div>
              <div>
                <div className="assistant-title">all.factory assistant</div>
                <div className="assistant-subtitle">Ask me anything</div>
              </div>
            </div>
            <div className="assistant-header-actions">
              {messages.length > 0 && (
                <button className="assistant-icon-btn" onClick={clearMessages} title="Clear chat">
                  <RotateCcw size={14} />
                </button>
              )}
              <button className="assistant-icon-btn" onClick={() => setMinimized(m => !m)} title="Minimize">
                <Minimize2 size={14} />
              </button>
              <button className="assistant-icon-btn" onClick={() => setOpen(false)} title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div className="assistant-messages">
                {messages.length === 0 ? (
                  <div className="assistant-welcome">
                    <div className="welcome-avatar">af</div>
                    <p className="welcome-title">Hi! I'm your all.factory assistant.</p>
                    <p className="welcome-sub">I know what page you're on and can help you use the app, understand your data, or navigate features.</p>
                    <div className="assistant-suggestions">
                      {suggestions.map(s => (
                        <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
                    {loading && (
                      <div className="assistant-msg bot">
                        <div className="bot-avatar">af</div>
                        <div className="msg-bubble typing">
                          <span/><span/><span/>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>

              {/* Input */}
              <div className="assistant-input-row">
                <textarea
                  ref={inputRef}
                  className="assistant-input"
                  placeholder="Ask a question…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  rows={1}
                  disabled={loading}
                />
                <button
                  className="assistant-send"
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                >
                  <Send size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}