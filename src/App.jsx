import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import ReceiptUpload from './pages/ReceiptUpload';
import ReceiptResults from './pages/ReceiptResults';
import ShoppingListPage from './pages/ShoppingListPage';
import NutritionPlanPage from './pages/NutritionPlanPage';
import FinalShoppingList from './pages/FinalShoppingList';
import FinalResults from './pages/FinalResults';
import PrintExport from './pages/PrintExport';
import DebugView from './pages/DebugView';
import AppLayout from './components/layout/AppLayout';

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/upload" element={<ReceiptUpload />} />
              <Route path="/receipt-results" element={<ReceiptResults />} />
              <Route path="/shopping-list" element={<ShoppingListPage />} />
              <Route path="/nutrition-plan" element={<NutritionPlanPage />} />
              <Route path="/final-list" element={<FinalShoppingList />} />
              <Route path="/results" element={<FinalResults />} />
              <Route path="/print" element={<PrintExport />} />
              <Route path="/debug" element={<DebugView />} />
            </Route>
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
