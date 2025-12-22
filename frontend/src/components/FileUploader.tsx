import { useCallback } from 'react';

interface Props {
  label: string;
  accept: string;
  onUpload: (file: File) => void;
  status: 'idle' | 'uploading' | 'success' | 'error';
  filename?: string;
}

export function FileUploader({ label, accept, onUpload, status, filename }: Props) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const inputId = `upload-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div
      className={`file-uploader ${status === 'success' ? 'uploaded' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <input 
        type="file" 
        accept={accept} 
        onChange={handleChange} 
        id={inputId} 
        className="file-input"
        disabled={status === 'uploading'} 
      />
      <label htmlFor={inputId} className="file-label">
        {status === 'uploading' && (
          <>
            <span className="upload-icon">⏳</span>
            <span className="upload-text">Uploading...</span>
          </>
        )}
        {status === 'success' && (
          <>
            <span className="upload-icon success">✓</span>
            <span className="file-name">{filename}</span>
            <span className="upload-status">Uploaded</span>
          </>
        )}
        {status === 'error' && (
          <>
            <span className="upload-icon">✕</span>
            <span className="upload-text">Upload failed</span>
            <span className="upload-hint">Click to retry</span>
          </>
        )}
        {status === 'idle' && (
          <>
            <span className="upload-icon">📄</span>
            <span className="upload-text">{label}</span>
            <span className="upload-hint">Drop file or click to browse</span>
          </>
        )}
      </label>
    </div>
  );
}