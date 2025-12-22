// Cache utilities for analytics data
// Uses localStorage with fallback handling for quota errors

const CACHE_KEY = 'cache_analytics_data';
const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

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

// Safe localStorage set with quota handling
function cacheSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e instanceof DOMException && (
      e.code === 22 || // QuotaExceededError
      e.code === 1014 || // NS_ERROR_DOM_QUOTA_REACHED (Firefox)
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )) {
      console.warn('Cache storage quota exceeded, attempting cleanup...');
      
      // Try to clear old cache entries
      try {
        // Clear our own cache first
        localStorage.removeItem(CACHE_KEY);
        
        // Try to set again
        localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        console.warn('Cache storage failed after cleanup, skipping cache');
        return false;
      }
    }
    console.error('Cache storage error:', e);
    return false;
  }
}

// Safe localStorage get
function cacheGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error('Cache retrieval error:', e);
    return null;
  }
}

// Compress data by removing large arrays if needed
function compressForCache(data: CachedAnalyticsData): CachedAnalyticsData {
  // Calculate rough size
  const fullJson = JSON.stringify(data);
  const sizeKB = fullJson.length / 1024;
  
  // If under 2MB, cache everything
  if (sizeKB < 2048) {
    return data;
  }
  
  console.log(`Analytics data is ${sizeKB.toFixed(0)}KB, compressing for cache...`);
  
  // Create compressed version - keep metadata but reduce large arrays
  const compressed: CachedAnalyticsData = {
    ...data,
    // Keep station analyses but remove large nested data
    stationAnalyses: data.stationAnalyses.map(sa => ({
      ...sa,
      // Keep summary data, remove detailed event lists
      events: undefined,
      rawEvents: undefined,
    })),
    // Keep cross-station analysis
    crossStationAnalysis: data.crossStationAnalysis,
    // Keep serial analyses but trim if very large
    serialAnalyses: data.serialAnalyses.slice(0, 100),
    // Don't cache allEvents - too large
    allEvents: [],
  };
  
  const compressedJson = JSON.stringify(compressed);
  console.log(`Compressed to ${(compressedJson.length / 1024).toFixed(0)}KB`);
  
  return compressed;
}

// Check if data is too large to cache
function isDataTooLarge(data: any): boolean {
  try {
    const json = JSON.stringify(data);
    // localStorage limit is typically 5-10MB, stay under 4MB to be safe
    return json.length > 4 * 1024 * 1024;
  } catch {
    return true;
  }
}

export function cacheAnalyticsData(data: Omit<CachedAnalyticsData, 'cachedAt'>): void {
  const cacheData: CachedAnalyticsData = {
    ...data,
    cachedAt: Date.now(),
  };
  
  // Try to compress if too large
  let dataToCache = cacheData;
  if (isDataTooLarge(cacheData)) {
    dataToCache = compressForCache(cacheData);
    
    // If still too large after compression, skip caching
    if (isDataTooLarge(dataToCache)) {
      console.warn('Analytics data too large to cache even after compression, skipping');
      return;
    }
  }
  
  const json = JSON.stringify(dataToCache);
  const success = cacheSet(CACHE_KEY, json);
  
  if (success) {
    console.log(`Analytics cached: ${(json.length / 1024).toFixed(0)}KB`);
  }
}

export function getCachedAnalyticsData(): CachedAnalyticsData | null {
  const json = cacheGet(CACHE_KEY);
  if (!json) return null;
  
  try {
    const data = JSON.parse(json) as CachedAnalyticsData;
    return data;
  } catch (e) {
    console.error('Failed to parse cached analytics data:', e);
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

export function hasValidAnalyticsCache(): boolean {
  const data = getCachedAnalyticsData();
  if (!data) return false;
  
  const age = Date.now() - data.cachedAt;
  if (age > CACHE_EXPIRY_MS) {
    console.log('Analytics cache expired');
    localStorage.removeItem(CACHE_KEY);
    return false;
  }
  
  return true;
}

export function getAnalyticsCacheInfo(): {
  exists: boolean;
  age: number;
  ageStr: string;
  remaining: number;
  remainingStr: string;
  stations: string[];
  fileCount: number;
} | null {
  const data = getCachedAnalyticsData();
  if (!data) return null;
  
  const age = Date.now() - data.cachedAt;
  const remaining = Math.max(0, CACHE_EXPIRY_MS - age);
  
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };
  
  const fileCount = Object.values(data.uploadedFiles || {})
    .reduce((sum, files) => sum + (files?.length || 0), 0);
  
  return {
    exists: true,
    age,
    ageStr: formatTime(age),
    remaining,
    remainingStr: formatTime(remaining),
    stations: data.stations || [],
    fileCount,
  };
}

export function clearAnalyticsCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    console.log('Analytics cache cleared');
  } catch (e) {
    console.error('Failed to clear analytics cache:', e);
  }
}

// Utility to clear all app caches if storage is getting full
export function clearAllCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cache_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`Cleared ${keysToRemove.length} cache entries`);
  } catch (e) {
    console.error('Failed to clear caches:', e);
  }
}