import { sendOfflineCamerasAlertEmail } from './mailService';
import { checkScheduledInventoryCameras } from './cameraScanner';
import { serverLogs } from '../routes/api';

let activeCameraScheduledTimes: string[] = ['07:00', '09:00', '11:00', '13:00', '15:00'];
let lastTriggeredCameraMinute = '';
let cameraSchedulerInterval: NodeJS.Timeout | null = null;
const CAMERA_RECIPIENTS = [
  'marko.lukic@unipromet.co.rs',
  'andrija.borovnjak@unipromet.co.rs'
];

/**
 * Initializes the background scheduler for automated offline camera alerts
 */
export function initCameraScheduler() {
  if (cameraSchedulerInterval) {
    clearInterval(cameraSchedulerInterval);
  }

  console.log(`[CameraScheduler] ⏰ Pokrenut automatski scheduler za kamere (Radni dani: Pon-Pet): aktivacija u ${activeCameraScheduledTimes.join(', ')}h (Lokalno vreme) ka ${CAMERA_RECIPIENTS.join(', ')}`);

  cameraSchedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Nedelja, 6 = Subota

      // Ne aktivira se vikendom (subota i nedelja)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return;
      }

      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${hours}:${minutes}`;
      const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${currentTime}`;

      if (activeCameraScheduledTimes.includes(currentTime)) {
        if (lastTriggeredCameraMinute !== todayKey) {
          lastTriggeredCameraMinute = todayKey;
          console.log(`\n⏰ [CameraScheduler] AKTIVIRAN ZADATAK U ${currentTime}! Proveravam offline kamere...`);

          serverLogs.push({
            id: serverLogs.length + 1,
            timestamp: now.toISOString(),
            level: 'info',
            message: `[CameraScheduler] Automatska provera dostupnosti kamera u ${currentTime}`,
            source: 'CameraScheduler'
          });

          // Verify offline cameras strictly from inventory (no range scanning)
          const offlineData = await checkScheduledInventoryCameras();
          const offlineCount = offlineData.offlineCount || 0;

          if (offlineCount > 0) {
            console.log(`[CameraScheduler] Pronađeno ${offlineCount} nedostupnih kamera. Šaljem alert email na ${CAMERA_RECIPIENTS.join(', ')}...`);
            const result = await sendOfflineCamerasAlertEmail(CAMERA_RECIPIENTS, offlineData);

            console.log(`✅ [CameraScheduler] Uspešno poslat email u ${currentTime} na ${result.recipient} (${offlineCount} offline kamera)`);

            serverLogs.push({
              id: serverLogs.length + 1,
              timestamp: new Date().toISOString(),
              level: 'success',
              message: `[CameraScheduler] Poslat izveštaj o ${offlineCount} nedostupnih kamera na ${result.recipient} (Status: 250 OK)`,
              source: 'CameraScheduler'
            });
          } else {
            console.log(`[CameraScheduler] Sve kamere (${offlineData.inventoryTotalCount}) su online. Nema potrebe za slanjem emaila.`);
            serverLogs.push({
              id: serverLogs.length + 1,
              timestamp: new Date().toISOString(),
              level: 'info',
              message: `[CameraScheduler] Sve kamere (${offlineData.inventoryTotalCount}) su online na mreži u ${currentTime}. Email nije poslat.`,
              source: 'CameraScheduler'
            });
          }
        }
      }
    } catch (err: any) {
      console.error('❌ [CameraScheduler] Greška prilikom automatske provere kamera:', err);
      serverLogs.push({
        id: serverLogs.length + 1,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[CameraScheduler] Greška pri proveri i slanju: ${err?.message}`,
        source: 'CameraScheduler'
      });
    }
  }, 3000); // Check every 3 seconds for precision
}

export function getCameraSchedulerStatus() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    currentTime: `${hours}:${minutes}:${seconds}`,
    activeCameraScheduledTimes,
    days: 'Ponedeljak - Petak (Radni dani)',
    isWeekend,
    lastTriggeredCameraMinute,
    recipients: CAMERA_RECIPIENTS
  };
}

export function addCameraScheduledTime(timeStr: string) {
  if (!activeCameraScheduledTimes.includes(timeStr)) {
    activeCameraScheduledTimes.push(timeStr);
  }
  return activeCameraScheduledTimes;
}
