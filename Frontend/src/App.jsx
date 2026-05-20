import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Sidebar from './components/Sidebar';
import TopAppBar from './components/TopAppBar';
import LoginView from './components/LoginView';
import DashboardView from './pages/DashboardView';
import FacultyView from './pages/FacultyView';
import FacultyLoadingView from './pages/FacultyLoadingView';
import FacultyLoadingFinalizeView from './pages/FacultyLoadingFinalizeView';
import SubjectsView from './pages/SubjectsView';
import RoomsView from './pages/RoomsView';
import ScheduleView from './pages/ScheduleView';
import CourseOfferingView from './pages/CourseOfferingView';
import SettingsView from './pages/SettingsView';
import { clearAllNotifications } from './services/notificationsApi';
import { recordLogout } from './services/auditLogsApi.js';
import { clearCurrentAuthUser, setCurrentAuthUser } from './services/authContext.js';
import { RowHighlightProvider } from './hooks/RowHighlightProvider.jsx';
import { NotificationProvider } from './hooks/NotificationProvider.jsx';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const [subjectMutationKey, setSubjectMutationKey] = useState(0);

  const handleOpenSettings = () => {
    setCurrentView('settings');
  };

  const handleViewChange = (view) => {
    setCurrentView(view);
  };

  const handleCurrentUserUpdate = (user) => {
    setCurrentUser(user);
    setCurrentAuthUser(user);
  };

  const handleLogin = async (user) => {
    setCurrentUser(user);
    setCurrentAuthUser(user);
    setAuthRefreshKey((value) => value + 1);
    setCurrentView('dashboard');
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await recordLogout();
    } catch (err) {
      console.error('Failed to record logout audit log:', err);
    }

    try {
      await clearAllNotifications();
    } catch (err) {
      console.error('Failed to clear notifications on logout:', err);
    }
    clearCurrentAuthUser();
    setCurrentUser(null);
    setAuthRefreshKey((value) => value + 1);
    setCurrentView('dashboard');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <LoginView onLogin={handleLogin} />;
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardView />;
      case 'faculty': return <FacultyView />;
      case 'subjects': return <SubjectsView subjectMutationKey={subjectMutationKey} />;
      case 'rooms': return <RoomsView authRefreshKey={authRefreshKey} />;
      case 'schedule': return <ScheduleView onNavigate={setCurrentView} />;
      case 'faculty-loading': return <FacultyLoadingView onNavigate={handleViewChange} />;
      case 'faculty-loading-finalize': return <FacultyLoadingFinalizeView onNavigate={handleViewChange} />;
      case 'course-offering': return <CourseOfferingView onSubjectMutated={() => setSubjectMutationKey((k) => k + 1)} />;
      case 'settings': return <SettingsView currentUser={currentUser} onUserUpdate={handleCurrentUserUpdate} />;
      default: return <DashboardView />;
    }
  };

  const getTitle = () => {
    if (currentView === 'faculty-loading-finalize') {
      return 'Finalize Faculty Loading';
    }

    return currentView
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <RowHighlightProvider>
      <NotificationProvider authRefreshKey={authRefreshKey}>
        <div className="min-h-screen overflow-x-hidden text-on-surface">
          <div className="fixed inset-0 bg-mesh -z-10" />

          <div className="min-h-screen flex min-w-0">
            <Sidebar
              currentView={currentView}
              onViewChange={handleViewChange}
              onLogout={handleLogout}
              currentUser={currentUser}
            />

            <main className="flex-1 min-h-screen min-w-0 ml-[260px] pt-16 overflow-x-hidden">
              <TopAppBar
                title={getTitle()}
                onLogout={handleLogout}
                onSettings={handleOpenSettings}
              />

              <div className="px-margin py-gutter max-w-7xl mx-auto w-full min-w-0 pb-16">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentView}
                    className="min-w-0"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.28, ease: 'easeOut' }}
                  >
                    {currentView === 'dashboard' ? (
                      <DashboardView onNavigate={handleViewChange} />
                    ) : (
                      renderView()
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <footer className="px-margin pb-8 pt-2 text-center">
                <p className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-[0.32em]">
                  Chronomaria • Faculty Loading System
                </p>
              </footer>
            </main>
          </div>
        </div>
      </NotificationProvider>
    </RowHighlightProvider>
  );
}
