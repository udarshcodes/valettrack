import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { OverviewPage } from './pages/OverviewPage';
import { SlotsPage } from './pages/SlotsPage';
import { TicketsPage } from './pages/TicketsPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { StaffPage } from './pages/StaffPage';
import { OccupancyAnalyticsPage } from './pages/OccupancyAnalyticsPage';
import { PricingAnalyticsPage } from './pages/PricingAnalyticsPage';
import { DatasetsPage } from './pages/DatasetsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="slots" element={<SlotsPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="occupancy" element={<OccupancyAnalyticsPage />} />
          <Route path="pricing" element={<PricingAnalyticsPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
