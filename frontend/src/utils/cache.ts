/**
 * Simple cache utility for temporary data persistence
 * Uses sessionStorage with TTL (time-to-live) expiration
 * 
 * Data persists for the browser session and auto-expires after the TTL
 * Default TTL is 5 minutes (300000ms)
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

const DEFAULT_TTL = 60 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Store data in cache with expiration
 */
export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    expiry: Date.now() + ttlMs,
  };
  
  try {
    sessionStorage.setItem(`cache_${key}`, JSON.stringify(entry));
  } catch (error) {
    // Handle quota exceeded or other storage errors
    console.warn('Cache storage failed:', error);
    // Try to clear old cache entries
    clearExpiredCache();
    try {
      sessionStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch {
      console.warn('Cache storage failed after cleanup');
    }
  }
}

/**
 * Get data from cache if not expired
 * Returns null if not found or expired
 */
export function cacheGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`cache_${key}`);
    if (!raw) return null;
    
    const entry: CacheEntry<T> = JSON.parse(raw);
    
    // Check if expired
    if (Date.now() > entry.expiry) {
      sessionStorage.removeItem(`cache_${key}`);
      return null;
    }
    
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Check if cache entry exists and is valid
 */
export function cacheHas(key: string): boolean {
  return cacheGet(key) !== null;
}

/**
 * Remove specific cache entry
 */
export function cacheRemove(key: string): void {
  sessionStorage.removeItem(`cache_${key}`);
}

/**
 * Clear all expired cache entries
 */
export function clearExpiredCache(): void {
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith('cache_')) {
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const entry = JSON.parse(raw);
          if (Date.now() > entry.expiry) {
            keysToRemove.push(key);
          }
        }
      } catch {
        keysToRemove.push(key!);
      }
    }
  }
  
  keysToRemove.forEach(key => sessionStorage.removeItem(key));
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith('cache_')) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => sessionStorage.removeItem(key));
}

/**
 * Get cache entry metadata (timestamp, expiry, age)
 */
export function cacheInfo(key: string): { 
  exists: boolean; 
  age?: number; 
  remainingTtl?: number;
  timestamp?: Date;
} {
  try {
    const raw = sessionStorage.getItem(`cache_${key}`);
    if (!raw) return { exists: false };
    
    const entry = JSON.parse(raw);
    const now = Date.now();
    
    if (now > entry.expiry) {
      return { exists: false };
    }
    
    return {
      exists: true,
      age: now - entry.timestamp,
      remainingTtl: entry.expiry - now,
      timestamp: new Date(entry.timestamp),
    };
  } catch {
    return { exists: false };
  }
}

// ============================================
// Analytics-specific cache helpers
// ============================================

export interface AnalyticsCacheData {
  // Analysis results
  stationAnalyses: any[];
  crossStationAnalysis: any | null;
  serialAnalyses: any[];
  allEvents: any[];
  
  // Metadata
  stations: string[];
  uploadedFiles: string[];
  analysisTimestamp: number;
}

const ANALYTICS_CACHE_KEY = 'analytics_data';
const ANALYTICS_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cache analytics data from uploaded files
 */
export function cacheAnalyticsData(data: AnalyticsCacheData): void {
  cacheSet(ANALYTICS_CACHE_KEY, data, ANALYTICS_TTL);
}

/**
 * Get cached analytics data
 */
export function getCachedAnalyticsData(): AnalyticsCacheData | null {
  return cacheGet<AnalyticsCacheData>(ANALYTICS_CACHE_KEY);
}

/**
 * Check if analytics cache is valid
 */
export function hasValidAnalyticsCache(): boolean {
  return cacheHas(ANALYTICS_CACHE_KEY);
}

/**
 * Get analytics cache info
 */
export function getAnalyticsCacheInfo() {
  const info = cacheInfo(ANALYTICS_CACHE_KEY);
  if (!info.exists) return null;
  
  return {
    ...info,
    ageFormatted: info.age ? formatDuration(info.age) : undefined,
    remainingFormatted: info.remainingTtl ? formatDuration(info.remainingTtl) : undefined,
  };
}

/**
 * Clear analytics cache
 */
export function clearAnalyticsCache(): void {
  cacheRemove(ANALYTICS_CACHE_KEY);
}

// Helper to format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}