import { Link } from 'react-router-dom';

export function Home() {
  return (
    <div className="home-page">
      <section className="hero-section">
        <span className="hero-badge">Factory Tools Suite</span>
        <h1>All.Factory</h1>
        <p className="hero-subtitle">
          Manufacturing data quality tools for production line optimization.
        </p>
      </section>

      <section className="features-section">
        <h2>Available Tools</h2>
        <div className="features-grid">
          <Link to="/data-cleanup" className="feature-card">
            <span className="feature-icon">🔧</span>
            <h3>Data Cleanup</h3>
            <p>Analyze and fix data issues in MMI logs and SQL databases. Detect duplicates, missing fields, orphan rows, and index mismatches.</p>
            <span className="feature-status available">Available</span>
          </Link>
          <div className="feature-card disabled">
            <span className="feature-icon">📊</span>
            <h3>Production Analytics</h3>
            <p>Visualize production line performance, track cycle times, and identify bottlenecks in real-time.</p>
            <span className="feature-status coming-soon">Coming Soon</span>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <p>Ready to clean your data?</p>
        <Link to="/data-cleanup" className="cta-button">
          Start Data Cleanup →
        </Link>
      </section>
    </div>
  );
}