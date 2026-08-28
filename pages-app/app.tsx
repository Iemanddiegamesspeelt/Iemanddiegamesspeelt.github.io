import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/shell';

const AuthCallbackPage = lazy(() => import('./pages/auth-callback').then((module) => ({ default: module.AuthCallbackPage })));
const AdminPage = lazy(() => import('./pages/admin').then((module) => ({ default: module.AdminPage })));
const BrowsePage = lazy(() => import('./pages/browse').then((module) => ({ default: module.BrowsePage })));
const CollectionsPage = lazy(() => import('./pages/collections').then((module) => ({ default: module.CollectionsPage })));
const CollectionPage = lazy(() => import('./pages/collections').then((module) => ({ default: module.CollectionPage })));
const ConverterPage = lazy(() => import('./pages/converter').then((module) => ({ default: module.ConverterPage })));
const HomePage = lazy(() => import('./pages/home').then((module) => ({ default: module.HomePage })));
const LeaderboardPage = lazy(() => import('./pages/leaderboard').then((module) => ({ default: module.LeaderboardPage })));
const LevelPage = lazy(() => import('./pages/level').then((module) => ({ default: module.LevelPage })));
const LoginPage = lazy(() => import('./pages/login').then((module) => ({ default: module.LoginPage })));
const MacroPage = lazy(() => import('./pages/macro').then((module) => ({ default: module.MacroPage })));
const NotFoundPage = lazy(() => import('./pages/not-found').then((module) => ({ default: module.NotFoundPage })));
const ProfilePage = lazy(() => import('./pages/profile').then((module) => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/settings').then((module) => ({ default: module.SettingsPage })));
const UploadPage = lazy(() => import('./pages/upload').then((module) => ({ default: module.UploadPage })));

export function App() {
  return <Suspense fallback={<div className="grid min-h-[75vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" /></div>}><Routes>
    <Route element={<Shell />}>
      <Route index element={<HomePage />} />
      <Route path="browse" element={<BrowsePage />} />
      <Route path="upload" element={<UploadPage />} />
      <Route path="converter" element={<ConverterPage />} />
      <Route path="level/:id" element={<LevelPage />} />
      <Route path="macro/:id" element={<MacroPage />} />
      <Route path="profile/:username" element={<ProfilePage />} />
      <Route path="collections" element={<CollectionsPage />} />
      <Route path="collection/:id" element={<CollectionPage />} />
      <Route path="leaderboard" element={<LeaderboardPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></Suspense>;
}
