import { Request, Response } from 'express';
import configService from '../../services/config.service';
import logger from '../../utils/logger';

export const getConfig = async (req: Request, res: Response) => {
  try {
    const config = configService.getConfig();
    // In a real application, you might want to obscure secrets in this response
    // But since it's an admin-only endpoint, we can return the whole config
    res.json({
      status: 'success',
      data: config
    });
  } catch (error) {
    logger.error('Error fetching config:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch configuration' });
  }
};

export const getUiConfig = async (req: Request, res: Response) => {
  try {
    const config = configService.getUiConfig();
    res.json({
      status: 'success',
      data: config
    });
  } catch (error) {
    logger.error('Error fetching UI config:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch UI configuration' });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    const history = await configService.getHistory();
    res.json({
      status: 'success',
      data: history
    });
  } catch (error) {
    logger.error('Error fetching config history:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch configuration history' });
  }
};

export const updateConfig = async (req: Request, res: Response) => {
  try {
    const newConfig = req.body;
    const result = await configService.updateConfig(newConfig);
    res.json({
      status: 'success',
      message: 'Configuration updated successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error updating config:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({ status: 'error', message: 'Validation failed', errors: JSON.parse(error.message) });
    } else {
      res.status(500).json({ status: 'error', message: 'Failed to update configuration' });
    }
  }
};

export const updateUiConfig = async (req: Request, res: Response) => {
  try {
    const result = await configService.updateUiConfig(req.body);
    res.json({
      status: 'success',
      message: 'UI configuration updated successfully',
      data: {
        version: result.version,
        ui: configService.getUiConfig(),
      }
    });
  } catch (error) {
    logger.error('Error updating UI config:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({ status: 'error', message: 'Validation failed', errors: JSON.parse(error.message) });
    } else {
      res.status(500).json({ status: 'error', message: 'Failed to update UI configuration' });
    }
  }
};

export const rollbackConfig = async (req: Request, res: Response) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (isNaN(version)) {
      return res.status(400).json({ status: 'error', message: 'Invalid version number' });
    }

    const result = await configService.rollbackToVersion(version);
    res.json({
      status: 'success',
      message: `Configuration rolled back to version ${version}`,
      data: result
    });
  } catch (error) {
    logger.error('Error rolling back config:', error);
    res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : 'Failed to rollback configuration' });
  }
};
