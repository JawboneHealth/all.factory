import { Link } from 'react-router-dom';

export function Home() {
  return (
    <div className="home-page">
      <section className="hero-section">
        <span className="hero-badge">Factory Tools Suite</span>
        <h1>all.factory</h1>
        <p className="hero-subtitle">
          Manufacturing data quality and analytics tools for production line optimization.
        </p>
      </section>

      <section className="features-section">
        <h2>Available Tools</h2>
        <div className="features-grid">
          <Link to="/data-cleanup" className="feature-card">
            <span className="feature-icon">🔧</span>
            <h3>Data Cleanup</h3>
            <p>Analyze and fix data issues in MMI logs and SQL databases. Detect duplicates, missing fields, orphan rows, and index mismatches.</p>
            <div className="feature-highlights">
              <span className="highlight-tag">6 Issue Types</span>
              <span className="highlight-tag">Auto-fix</span>
              <span className="highlight-tag">Export</span>
            </div>
            <span className="feature-status available">Available</span>
          </Link>
          
          <Link to="/analytics" className="feature-card">
            <span className="feature-icon">📊</span>
            <h3>Production Analytics</h3>
            <p>Multi-station analysis for cycle times, errors, throughput, and cross-station patterns. Visualize production performance.</p>
            <div className="feature-highlights">
              <span className="highlight-tag">6 Stations</span>
              <span className="highlight-tag">5 Views</span>
              <span className="highlight-tag">Real-time</span>
            </div>
            <span className="feature-status available">Available</span>
          </Link>
        </div>
      </section>

      <section className="tools-overview">
        <h2>What You Can Do</h2>
        <div className="overview-grid">
          <div className="overview-card">
            <div className="overview-icon cleanup">🔧</div>
            <div className="overview-content">
              <h4>Data Cleanup</h4>
              <ul>
                <li>Detect duplicate INSERT statements</li>
                <li>Find missing PSA tape pictures</li>
                <li>Identify orphan rows with no serial numbers</li>
                <li>Fix PSA image index mismatches</li>
                <li>Reconcile SQL/MMI error discrepancies</li>
                <li>Remove repeated log entries</li>
              </ul>
            </div>
          </div>
          
          <div className="overview-card">
            <div className="overview-icon analytics">📊</div>
            <div className="overview-content">
              <h4>Production Analytics</h4>
              <ul>
                <li>Station dashboards with KPIs</li>
                <li>Error timeline visualization</li>
                <li>Event timeline with filtering</li>
                <li>Cross-station issue detection</li>
                <li>Serial-by-serial cycle analysis</li>
                <li>Production run tracking</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="stations-section">
        <h2>Supported Stations</h2>
        <div className="stations-row">
          <div className="station-chip" style={{ '--chip-color': '#818cf8' } as React.CSSProperties}>
            <span className="chip-icon">📦</span>
            <span>Bottom Shell</span>
          </div>
          <div className="station-chip" style={{ '--chip-color': '#34d399' } as React.CSSProperties}>
            <span className="chip-icon">🔋</span>
            <span>Battery</span>
          </div>
          <div className="station-chip" style={{ '--chip-color': '#f472b6' } as React.CSSProperties}>
            <span className="chip-icon">🔄</span>
            <span>Trans</span>
          </div>
          <div className="station-chip" style={{ '--chip-color': '#fbbf24' } as React.CSSProperties}>
            <span className="chip-icon">🔝</span>
            <span>Top Shell</span>
          </div>
          <div className="station-chip" style={{ '--chip-color': '#ef4444' } as React.CSSProperties}>
            <span className="chip-icon">⚡</span>
            <span>Laser</span>
          </div>
          <div className="station-chip" style={{ '--chip-color': '#06b6d4' } as React.CSSProperties}>
            <span className="chip-icon">🧪</span>
            <span>FVT</span>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <p>Ready to optimize your production line?</p>
        <div className="cta-buttons">
          <Link to="/data-cleanup" className="cta-button primary">
            Start Data Cleanup →
          </Link>
          <Link to="/analytics" className="cta-button secondary">
            View Analytics →
          </Link>
        </div>
      </section>
    </div>
  );
}