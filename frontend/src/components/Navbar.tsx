import { NavLink } from 'react-router-dom';
import { Settings, Wrench, BarChart3 } from 'lucide-react';

export function Navbar() {
  return (
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
        <span className="nav-version">v1.0</span>
      </div>
    </nav>
  );
}
