import * as cron from 'node-cron';
import { deleteLog, deleteLogsMessages, errorManager, ErrorSourceEnum, findOldActivities, logger, MetricTypes, telemetry } from '@nangohq/shared';
import tracer from '../tracer.js';
import { setTimeout } from 'node:timers/promises';

// Retention in days
const retention = parseInt(process.env['NANGO_CLEAR_ACTIVIES_RETENTION'] || '', 10) || 15;
const limitLog = parseInt(process.env['NANGO_CLEAR_ACTIVIES_LIMIT'] || '', 10) || 2000;
const limitMsg = parseInt(process.env['NANGO_CLEAR_ACTIVIES_MSG_LIMIT'] || '', 10) || 5000;

export async function deleteOldActivityLogs(): Promise<void> {
    /**
     * Delete all activity logs older than 15 days
     */
    cron.schedule('*/10 * * * *', async () => {
        const start = Date.now();
        try {
            await exec();
        } catch (err: unknown) {
            const e = new Error('failed_to_clean_activity_logs_table', { cause: err instanceof Error ? err.message : err });
            errorManager.report(e, { source: ErrorSourceEnum.PLATFORM }, tracer);
        }
        telemetry.duration(MetricTypes.JOBS_CLEAN_ACTIVITY_LOGS, Date.now() - start);
    });
}

/**
 * Postgres does not allow DELETE LIMIT so we batch ourself to limit the memory footprint of this query.
 */
export async function exec(): Promise<void> {
    logger.info('[oldActivity] starting');

    const logs = await findOldActivities({ retention, limit: limitLog });
    logger.info(`[oldActivity] found ${logs.length} syncs`);

    for (const log of logs) {
        logger.info(`[oldActivity] deleting syncId: ${log.id}`);
        let count = 0;
        do {
            count = await deleteLogsMessages({ activityLogId: log.id, limit: limitMsg });
            logger.info(`[oldActivity] deleted ${count} rows`);

            // Free the CPU
            await setTimeout(200);
        } while (count >= limitMsg);

        await deleteLog({ activityLogId: log.id });
    }

    logger.info('[oldActivity] done');
}
