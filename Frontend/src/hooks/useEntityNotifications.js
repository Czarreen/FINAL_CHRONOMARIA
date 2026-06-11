import { useState, useEffect, useCallback } from 'react';
import {
  fetchCourseOfferingNotifications,
  rescanAllCourseOfferingNotifications,
  resolveCourseOfferingNotification,
  fetchPersistedSubjectNotifications,
  rescanAllSubjectNotifications,
  resolveSubjectNotification,
} from '../services/notificationsApi';
import { transformRows } from '../utils/notificationTransform';

// ---------------------------------------------------------------------------
// Internal helpers — not exported; keeps the hook surface clean
// ---------------------------------------------------------------------------

async function fetchPersisted(type) {
  if (type === 'course_offering') {
    return fetchCourseOfferingNotifications({ page: 1, limit: 500, unresolvedOnly: true });
  }
  return fetchPersistedSubjectNotifications({ page: 1, limit: 500 });
}

async function rescanAll(type, force = false) {
  if (type === 'course_offering') {
    return rescanAllCourseOfferingNotifications(force);
  }
  return rescanAllSubjectNotifications();
}

function resolveOne(type, dbId) {
  if (type === 'course_offering') {
    return resolveCourseOfferingNotification(dbId);
  }
  return resolveSubjectNotification(dbId);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared notification lifecycle hook for course offerings and subjects.
 *
 * @param {'course_offering'|'subject'} type
 * @param {{ refreshTrigger?: number }} options
 * @returns {{
 *   notifications: object[],
 *   loading: boolean,
 *   rescan: () => void,
 *   resolve: (item: object) => void,
 *   refresh: () => void,
 * }}
 */
export function useEntityNotifications(type, { refreshTrigger = 0 } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async ({ forceRescan = false } = {}) => {
      let active = true;
      setLoading(true);

      try {
        if (forceRescan) {
          await rescanAll(type, true);
        }

        const payload = await fetchPersisted(type);
        if (!active) return;

        let rows = payload.rows || [];
        const rowCount = payload.total ?? rows.length;

        if (rowCount === 0 && !forceRescan) {
          // DB is empty — auto-populate by scanning all entities once
          await rescanAll(type);
          if (!active) return;
          const refetched = await fetchPersisted(type);
          if (!active) return;
          rows = refetched.rows || [];
        }

        setNotifications(transformRows(type, rows));
      } catch (err) {
        if (active) setNotifications([]);
      } finally {
        if (active) setLoading(false);
      }

      return () => { active = false; };
    },
    [type]
  );

  useEffect(() => {
    let cancelled = false;
    load().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, type]);

  const rescan = useCallback(() => {
    load({ forceRescan: true });
  }, [load]);

  const resolve = useCallback(
    async (item) => {
      // Optimistic removal
      setNotifications((prev) => prev.filter((n) => n.id !== item.id));
      try {
        await Promise.all((item.dbIds || []).map((dbId) => resolveOne(type, dbId)));
      } catch (err) {
        // Restore by re-fetching
        load().catch(() => {});
      }
    },
    [type, load]
  );

  const refresh = useCallback(() => {
    load().catch(() => {});
  }, [load]);

  return { notifications, loading, rescan, resolve, refresh };
}
