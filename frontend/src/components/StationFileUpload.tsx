import { useCallback } from 'react';
import { type Station, type StationFiles } from '../types';

interface Props {
  station: Station;
  files?: StationFiles;
  onUpload: (type: 'barcode' | 'error' | 'sql', file: File) => void;
  onRemove: (type: 'barcode' | 'error' | 'sql') => void;
}

export function StationFileUpload({ station, files, onUpload, onRemove }: Props) {
  const handleDrop = useCallback((type: 'barcode' | 'error' | 'sql') => (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onUpload(type, file);
  }, [onUpload]);

  const handleChange = useCallback((type: 'barcode' | 'error' | 'sql') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(type, file);
  }, [onUpload]);

  const fileSlots: Array<{ type: 'barcode' | 'error' | 'sql'; label: string; accept: string; filename?: string }> = [
    { type: 'barcode', label: 'Barcode Log', accept: '.log,.txt', filename: files?.barcodeLogName },
    { type: 'error', label: 'Error Log', accept: '.log,.txt', filename: files?.errorLogName },
    { type: 'sql', label: 'SQL Export', accept: '.xlsx,.xls,.csv', filename: files?.sqlExportName },
  ];

  const uploadedCount = fileSlots.filter(s => s.filename).length;

  return (
    <div className="station-upload-card" style={{ '--station-color': station.color } as React.CSSProperties}>
      <div className="station-upload-header">
        <span className="station-icon">{station.icon}</span>
        <span className="station-name">{station.name}</span>
        {uploadedCount > 0 && (
          <span className="upload-count">{uploadedCount}/3</span>
        )}
      </div>
      
      {station.note && (
        <div className={`station-note ${station.noteType || ''}`}>
          {station.note}
        </div>
      )}

      <div className="file-slots">
        {fileSlots.map(({ type, label, accept, filename }) => (
          <div 
            key={type}
            className={`file-slot ${filename ? 'has-file' : ''}`}
            onDrop={handleDrop(type)}
            onDragOver={(e) => e.preventDefault()}
          >
            {filename ? (
              <>
                <span className="file-icon">✓</span>
                <span className="file-name" title={filename}>{filename}</span>
                <button 
                  className="remove-file" 
                  onClick={() => onRemove(type)}
                  title="Remove file"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <input
                  type="file"
                  accept={accept}
                  onChange={handleChange(type)}
                  id={`${station.code}-${type}`}
                  className="file-input"
                />
                <label htmlFor={`${station.code}-${type}`} className="file-label">
                  <span className="file-icon">+</span>
                  <span className="file-type">{label}</span>
                </label>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
