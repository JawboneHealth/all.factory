import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Settings, Wrench, BarChart3, AlertCircle } from 'lucide-react';
import { ReportModal } from './ReportModal';

export function Navbar() {
  const [reportOpen, setReportOpen] = useState(false);
  const location = useLocation();

  const pageLabel = () => {
    if (location.pathname === '/data-cleanup') return 'Data Cleanup';
    if (location.pathname.startsWith('/analytics')) return 'Analytics';
    return 'Home';
  };

  return (
    <>
      <nav className="main-nav">
        <div className="nav-left">
          <NavLink to="/" className="nav-brand">
            <span className="brand-icon"><Settings size={20} /></span>
            all.factory
          </NavLink>
          <div className="nav-links">
            <NavLink to="/data-cleanup" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon"><Wrench size={16} /></span>
              Data Cleanup
            </NavLink>
            <NavLink to="/analytics" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon"><BarChart3 size={16} /></span>
              Analytics
            </NavLink>
          </div>
        </div>
        <div className="nav-right">
          <button className="nav-report-btn" onClick={() => setReportOpen(true)}>
            <AlertCircle size={14} />
            Report Issue
          </button>
          <span className="nav-version">v1.2</span>
        </div>
      </nav>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        currentPage={pageLabel()}
      />
    </>
  );
}