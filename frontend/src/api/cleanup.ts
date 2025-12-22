const API_BASE = 'http://localhost:8000';

export async function uploadMMI(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/cleanup/upload/mmi`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

export async function uploadSQL(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/cleanup/upload/sql`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

export async function analyze() {
  const res = await fetch(`${API_BASE}/cleanup/analyze`, {
    method: 'POST',
  });
  return res.json();
}

export async function getIssues() {
  const res = await fetch(`${API_BASE}/cleanup/issues`);
  return res.json();
}