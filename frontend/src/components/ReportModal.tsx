import { useState, useRef, useCallback } from 'react';
import { X, Paperclip, Send, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import './ReportModal.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  currentPage?: string;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export function ReportModal({ open, onClose, currentPage }: ReportModalProps) {
  const [title, setTitle]       = useState('');
  const [description, setDesc]  = useState('');
  const [files, setFiles]       = useState<File[]>([]);
  const [status, setStatus]     = useState<Status>('idle');
  const [issueUrl, setIssueUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef            = useRef<HTMLInputElement>(null);
  const dropRef                 = useRef<HTMLDivElement>(null);

  const reset = () => {
    setTitle('');
    setDesc('');
    setFiles([]);
    setStatus('idle');
    setIssueUrl('');
    setErrorMsg('');
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !names.has(f.name))];
    });
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }, []);

  // Early return AFTER all hooks
  if (!open) return null;

  const handleClose = () => {
    if (status === 'loading') return;
    reset();
    onClose();
  };

  const removeFile = (name: string) =>
    setFiles(prev => prev.filter(f => f.name !== name));

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setStatus('loading');
    setErrorMsg('');

    const form = new FormData();
    form.append('title', title.trim());
    form.append('description', description.trim());
    if (currentPage) form.append('page', currentPage);
    files.forEach(f => form.append('files', f));

    try {
      const res  = await fetch(`${API_BASE}/github/issue`, { method: 'POST', body: form });
      const data = await res.json();
      if (data.url) {
        setIssueUrl(data.url);
        setStatus('success');
      } else {
        setErrorMsg(data.error || 'Unknown error');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Could not reach the server.');
      setStatus('error');
    }
  };

  const formatBytes = (n: number) =>
    n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1048576).toFixed(1)}MB`;

  return (
    <div className="report-overlay" onClick={handleClose}>
      <div className="report-modal" onClick={e => e.stopPropagation()}>

        <div className="report-header">
          <span className="report-title">Report an Issue</span>
          <button className="report-close" onClick={handleClose} disabled={status === 'loading'}>
            <X size={16} />
          </button>
        </div>

        {status === 'success' ? (
          <div className="report-success">
            <CheckCircle size={36} className="success-icon" />
            <p className="success-heading">Issue filed</p>
            <p className="success-sub">GitHub issue created successfully.</p>
            <a href={issueUrl} target="_blank" rel="noreferrer" className="success-link">
              View on GitHub →
            </a>
            <button className="report-btn-primary" onClick={handleClose}>Done</button>
          </div>
        ) : (
          <div className="report-body">

            <label className="report-label">Title</label>
            <input
              className="report-input"
              placeholder="Short description of the issue"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={status === 'loading'}
              maxLength={200}
            />

            <label className="report-label">Description</label>
            <textarea
              className="report-textarea"
              placeholder="Steps to reproduce, what you expected, what happened instead..."
              value={description}
              onChange={e => setDesc(e.target.value)}
              disabled={status === 'loading'}
              rows={5}
            />

            <div
              ref={dropRef}
              className={`report-dropzone ${files.length > 0 ? 'has-files' : ''}`}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} />
              <span>Attach files — drag & drop or click</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="*/*"
                style={{ display: 'none' }}
                onChange={e => addFiles(e.target.files)}
              />
            </div>

            {files.length === 0 && (
              <p className="report-file-hint">
                Images, videos, PDFs, Excel, logs, CSV — max 50MB per file, 10 files total
              </p>
            )}

            {files.length > 0 && (
              <ul className="report-file-list">
                {files.map(f => (
                  <li key={f.name} className="report-file-item">
                    <span className="file-name">{f.name}</span>
                    <span className="file-size">{formatBytes(f.size)}</span>
                    <button
                      className="file-remove"
                      onClick={() => removeFile(f.name)}
                      disabled={status === 'loading'}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {status === 'error' && (
              <div className="report-error">
                <AlertCircle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="report-footer">
              {currentPage && (
                <span className="report-page-tag">📍 {currentPage}</span>
              )}
              <button
                className="report-btn-primary"
                onClick={handleSubmit}
                disabled={!title.trim() || !description.trim() || status === 'loading'}
              >
                {status === 'loading'
                  ? <><Loader size={14} className="spin" /> Submitting…</>
                  : <><Send size={14} /> Submit Issue</>
                }
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}