import { Router } from 'express';
import {
  getGaPreFlight,
  postRunFacultyLoading,
  getAutomaticSchedulerPreFlight,
  postRunAutomaticScheduler,
  getAutomaticSchedulerRows,
  exportAutomaticSchedulerRows,
  postAutomaticSchedulerUpdateCourseOffering,
} from '../controllers/gaController.js';

const router = Router();

router.get('/pre-flight', getGaPreFlight);
router.post('/run/faculty', postRunFacultyLoading);

router.get('/automatic/pre-flight', getAutomaticSchedulerPreFlight);
router.post('/run/automatic-scheduler', postRunAutomaticScheduler);
router.get('/automatic/rows', getAutomaticSchedulerRows);
router.get('/automatic/export', exportAutomaticSchedulerRows);
router.post('/automatic/update-course-offering', postAutomaticSchedulerUpdateCourseOffering);

export default router;
