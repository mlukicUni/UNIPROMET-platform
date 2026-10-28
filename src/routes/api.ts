/**
 * Backwards compatibility proxy.
 * Routes are now modularized under:
 * - src/routes/system.routes.ts
 * - src/routes/printer.routes.ts
 * - src/routes/camera.routes.ts
 * - src/routes/network.routes.ts
 * - src/routes/inventory.routes.ts
 * - src/routes/report.routes.ts
 * - src/routes/index.ts
 */
export { apiRouter, serverLogs, default } from './index';
