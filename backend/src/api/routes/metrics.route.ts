import { Router, Request, Response } from 'express';
import { metricsService } from '../../services/metrics.service';

const router = Router();

/**
 * GET /metrics
 * 
 * Prometheus metrics endpoint - returns metrics in Prometheus format
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', metricsService.getRegistry().contentType);
    res.send(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /metrics/json
 * 
 * Returns metrics in JSON format for easier debugging
 */
router.get('/json', async (req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getRegistry().getMetricsAsJSON();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
