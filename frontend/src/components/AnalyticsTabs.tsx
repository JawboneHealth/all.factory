import { type AnalyticsTab, type AnalyticsState } from '../types';

interface Props {
  activeTab: AnalyticsTab;
  onTabChange: (tab: AnalyticsTab) => void;
  state: AnalyticsState;
}

const TABS: Array<{ id: AnalyticsTab; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'errors', label: 'Error Timeline', icon: '⚠️' },
  { id: 'timeline', label: 'Event Timeline', icon: '📈' },
  { id: 'issues', label: 'Cross-Station Issues', icon: '🔗' },
  { id: 'serial', label: 'Serial Analysis', icon: '🔢' },
];

export function AnalyticsTabs({ activeTab, onTabChange, state }: Props) {
  // Calculate badge counts
  const getBadge = (tabId: AnalyticsTab): number | null => {
    switch (tabId) {
      case 'dashboard':
        return state.stationAnalyses.length;
      case 'errors':
        return state.stationAnalyses.reduce((sum, s) => sum + (s.errors?.totalErrors || 0), 0);
      case 'timeline':
        return state.allEvents.length;
      case 'issues':
        return state.crossStationAnalysis 
          ? state.crossStationAnalysis.cascades.length + 
            state.crossStationAnalysis.recurring.length +
            state.crossStationAnalysis.sequences.length
          : null;
      case 'serial':
        return state.serialAnalyses.reduce((sum, s) => sum + s.stats.totalUnits, 0);
      default:
        return null;
    }
  };

  return (
    <div className="analytics-tabs">
      {TABS.map(tab => {
        const badge = getBadge(tab.id);
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            className={`analytics-tab ${isActive ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
            {badge !== null && badge > 0 && (
              <span className="tab-badge">{badge > 999 ? '999+' : badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
