import { useState, useRef, useCallback, useEffect } from 'react';
import { NotificationContext } from './NotificationContext';
import { useEntityNotifications } from './useEntityNotifications';
import { rescanAllEntities } from '../services/notificationsApi';

export function NotificationProvider({ children, authRefreshKey = 0 }) {
  const [coKey, setCoKey] = useState(0);
  const [subjectKey, setSubjectKey] = useState(0);
  const [rescanning, setRescanning] = useState(false);

  const prevAuthKeyRef = useRef(authRefreshKey);

  // When authRefreshKey changes (login/logout), bump both keys to re-fetch
  useEffect(() => {
    if (prevAuthKeyRef.current !== authRefreshKey) {
      prevAuthKeyRef.current = authRefreshKey;
      setCoKey((k) => k + 1);
      setSubjectKey((k) => k + 1);
    }
  }, [authRefreshKey]);

  const {
    notifications: coNotifications,
    loading: coLoading,
    resolve: resolveCO,
    refresh: refreshCO,
  } = useEntityNotifications('course_offering', { refreshTrigger: coKey });

  const {
    notifications: subjectNotifications,
    loading: subjectLoading,
    resolve: resolveSubject,
    refresh: refreshSubject,
  } = useEntityNotifications('subject', { refreshTrigger: subjectKey });

  const triggerCoRefresh = useCallback(() => {
    setCoKey((k) => k + 1);
  }, []);

  const rescanBoth = useCallback(async () => {
    setRescanning(true);
    try {
      await rescanAllEntities(true);
      setCoKey((k) => k + 1);
      setSubjectKey((k) => k + 1);
    } catch (err) {
    } finally {
      setRescanning(false);
    }
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        coNotifications,
        coLoading,
        resolveCO,
        refreshCO,
        triggerCoRefresh,
        subjectNotifications,
        subjectLoading,
        resolveSubject,
        refreshSubject,
        rescanBoth,
        rescanning,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
