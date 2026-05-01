import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Sidebar from './components/Sidebar';
import TopAppBar from './components/TopAppBar';
import LoginView from './components/LoginView';
import DashboardView from './pages/DashboardView';
import FacultyView from './pages/FacultyView';
import SubjectsView from './pages/SubjectsView';
import RoomsView from './pages/RoomsView';
import ScheduleView from './pages/ScheduleView';
import CourseOfferingView from './pages/CourseOfferingView';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState('course-offering');

  if (!isAuthenticated) {
    return <LoginView onLogin={() => setIsAuthenticated(true)} />;
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardView />;
      case 'faculty': return <FacultyView />;
      case 'subjects': return <SubjectsView />;
      case 'rooms': return <RoomsView />;
      case 'schedule': return <ScheduleView />;
      case 'course-offering': return <CourseOfferingView />;
      default: return <DashboardView />;
    }
  };

  const getTitle = () => {
    return currentView
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="min-h-screen text-on-surface">
      <div className="fixed inset-0 bg-mesh -z-10" />

      <div className="min-h-screen flex">
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          onLogout={() => setIsAuthenticated(false)}
        />

        <main className="flex-1 min-h-screen ml-[260px] pt-16">
          <TopAppBar
            title={getTitle()}
            onLogout={() => setIsAuthenticated(false)}
          />

          <div className="px-margin py-gutter max-w-7xl mx-auto w-full pb-16">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                {currentView === 'dashboard' ? (
                  <DashboardView onNavigate={setCurrentView} />
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
  );
}
