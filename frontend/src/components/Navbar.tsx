import { NavLink } from 'react-router-dom';

export function Navbar() {
  return (
    <nav className="main-nav">
      <div className="nav-left">
        <NavLink to="/" className="nav-brand">
          <span className="brand-icon">⚙</span>
          All.Factory
        </NavLink>
        <div className="nav-links">
          <NavLink to="/data-cleanup" className={({ isActive }) => isActive ? 'active' : ''}>Data Cleanup</NavLink>
        </div>
      </div>
    </nav>
  );
}