import { startWorker } from './recurring-payments.worker';
import cron from 'node-cron';
import { RecurringPaymentsService } from '../services/recurring-payments.service';

jest.mock('node-cron', () => ({
  validate: jest.fn().mockReturnValue(true),
  schedule: jest.fn().mockImplementation((sched, cb) => {
    cb();
    return {};
  }),
}));

jest.mock('../services/recurring-payments.service', () => {
  return {
    RecurringPaymentsService: jest.fn().mockImplementation(() => {
      return {
        processDueSchedules: jest.fn().mockResolvedValue(5),
      };
    }),
  };
});

describe('recurring-payments.worker', () => {
  it('should start worker and process due schedules', async () => {
    startWorker();
    expect(cron.validate).toHaveBeenCalled();
    expect(cron.schedule).toHaveBeenCalled();
  });
});
