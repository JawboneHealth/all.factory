import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { DataCleanup } from './pages/DataCleanup';
import { ProductAnalytics } from './pages/ProductAnalytics';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/data-cleanup" element={<DataCleanup />} />
            <Route path="/analytics" element={<ProductAnalytics />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;