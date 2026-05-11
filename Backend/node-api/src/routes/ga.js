import { Router } from 'express';
import { getGaPreFlight, postRunFacultyLoading } from '../controllers/gaController.js';

const router = Router();

router.get('/pre-flight', getGaPreFlight);
router.post('/run/faculty', postRunFacultyLoading);

export default router;