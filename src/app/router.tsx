import { Navigate, createBrowserRouter, createHashRouter } from 'react-router-dom'
import { HomePage } from '../features/home/HomePage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ImportsPage } from '../features/imports/ImportsPage'
import { InventoryPage } from '../features/inventory/InventoryPage'
import { SalesPage } from '../features/sales/SalesPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { BackupRestorePage } from '../features/settings/BackupRestorePage'
import { UpdatePage } from '../features/settings/UpdatePage'
import { AppShell } from './shell/AppShell'
import { isDesktopApp } from '../lib/platform'

const desktopRoutes = [
  {
    path: '/',
    element: <Navigate replace to="/app" />,
  },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'sales', element: <SalesPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'imports', element: <ImportsPage /> },
      { path: 'backups', element: <BackupRestorePage /> },
      { path: 'updates', element: <UpdatePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate replace to="/app" />,
  },
]

const webRoutes = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'sales', element: <SalesPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'imports', element: <ImportsPage /> },
      { path: 'backups', element: <BackupRestorePage /> },
      { path: 'updates', element: <UpdatePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate replace to="/" />,
  },
]

export const router = isDesktopApp() ? createHashRouter(desktopRoutes) : createBrowserRouter(webRoutes)
