import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { DataCleanup } from './pages/DataCleanup';
import { ProductAnalytics } from './pages/ProductAnalytics';
import { AssistantProvider } from './components/Assistant/AssistantContext';
import { AssistantChat } from './components/Assistant/AssistantChat';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AssistantProvider>
        <div className="app">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/data-cleanup" element={<DataCleanup />} />
              <Route path="/analytics" element={<ProductAnalytics />} />
            </Routes>
          </main>
          <AssistantChat />
        </div>
      </AssistantProvider>
    </BrowserRouter>
  );
}

export default App;