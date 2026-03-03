// Cache utilities for analytics data
// Uses backend in-memory storage instead of localStorage (no size limits)

const API_BASE = 'http://localhost:8001';

interface CachedAnalyticsData {
  stationAnalyses: any[];
  crossStationAnalysis: any;
  serialAnalyses: any[];
  allEvents: any[];
  stations: string[];
  uploadedFiles: Record<string, string[]>;
  analysisTimestamp: number;
  cachedAt: number;
}

export async function cacheAnalyticsData(_data: any): Promise<void> {
  // No-op: the backend already stores results when /analyze runs.
  // Kept for API compatibility with ProductAnalytics.tsx.
}

export async function getCachedAnalyticsData(): Promise<CachedAnalyticsData | null> {
  try {
    const res = await fetch(`${API_BASE}/analytics/results`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.station_analyses) return null;
    return {
      stationAnalyses: data.station_analyses || [],
      crossStationAnalysis: data.cross_station || null,
      serialAnalyses: data.serial_analyses || [],
      allEvents: data.all_events || [],
      stations: [],
      uploadedFiles: {},
      analysisTimestamp: 0,
      cachedAt: 0,
    };
  } catch (e) {
    console.error('Failed to fetch cached analytics:', e);
    return null;
  }
}

export async function hasValidAnalyticsCache(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/analytics/results/status`);
    if (!res.ok) return false;
    const status = await res.json();
    return status.exists && !status.expired;
  } catch {
    return false;
  }
}

export async function getAnalyticsCacheInfo(): Promise<{
  exists: boolean;
  age: number;
  ageStr: string;
  remaining: number;
  remainingStr: string;
  stations: string[];
  fileCount: number;
} | null> {
  try {
    const res = await fetch(`${API_BASE}/analytics/results/status`);
    if (!res.ok) return null;
    const status = await res.json();
    if (!status.exists) return null;
    return status;
  } catch {
    return null;
  }
}

export async function clearAnalyticsCache(): Promise<void> {
  try {
    await fetch(`${API_BASE}/analytics/results/cache`, { method: 'DELETE' });
    console.log('Analytics cache cleared');
  } catch (e) {
    console.error('Failed to clear analytics cache:', e);
  }
}