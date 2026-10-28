import { Router } from 'express';
import { systemRouter, serverLogs } from './system.routes';
import { printerRouter } from './printer.routes';
import { cameraRouter } from './camera.routes';
import { networkRouter } from './network.routes';
import { inventoryRouter } from './inventory.routes';
import { reportRouter, mailRouter } from './report.routes';
import { schedulerRouter } from './scheduler.routes';
import { authRouter } from './auth.routes';
import { equipmentRouter } from './equipment.routes';
import { mtsRouter } from './mts.routes';
import { networkEquipmentRouter } from './networkEquipment.routes';
import { linesRouter } from './lines.routes';
import { networkNodesRouter } from './networkNodes.routes';
import { switchesRouter } from './switches.routes';
import { accessRouter } from './access.routes';
import { monitoringRouter } from './monitoring.routes';

export const apiRouter = Router();

// Re-export serverLogs and authRouter for backwards compatibility
export { serverLogs, authRouter, equipmentRouter, mtsRouter, networkEquipmentRouter, linesRouter, networkNodesRouter, switchesRouter };

// Mount modular sub-routers
apiRouter.use('/', systemRouter);
apiRouter.use('/printers', printerRouter);
apiRouter.use('/cameras', cameraRouter);
apiRouter.use('/network', networkRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/equipment', equipmentRouter);
apiRouter.use('/mts', mtsRouter);
apiRouter.use('/network-equipment', networkEquipmentRouter);
apiRouter.use('/network-nodes', networkNodesRouter);
apiRouter.use('/lines', linesRouter);
apiRouter.use('/switches', switchesRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/scheduler', schedulerRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/access', accessRouter);
apiRouter.use('/monitoring', monitoringRouter);

// Dedicated mail endpoints under /mail
apiRouter.use('/mail', mailRouter);

export default apiRouter;

