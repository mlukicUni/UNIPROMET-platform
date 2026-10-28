import { sendLowTonersAlertEmail, DEFAULT_ADMIN_RECIPIENTS } from './mailService';
import { serverLogs } from '../routes/api';

let activeScheduledTimes: string[] = ['07:00']; // Daily at 07:00 AM
let lastTriggeredMinute = '';
let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Initializes the background scheduler for automated low toner emails
 */
export function initTonerScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log(`[Scheduler] ⏰ Pokrenut automatski dnevni scheduler tonera (Radni dani: Pon-Pet): u ${activeScheduledTimes.join(', ')}h (Lokalno vreme)`);

  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Nedelja, 6 = Subota

      // Ne šalje se vikendom (subota i nedelja)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return;
      }

      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${hours}:${minutes}`;
      const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${currentTime}`;

      if (activeScheduledTimes.includes(currentTime)) {
        if (lastTriggeredMinute !== todayKey) {
          lastTriggeredMinute = todayKey;
          console.log(`\n⏰ [Scheduler] AKTIVIRAN ZADATAK U ${currentTime}! Pokrećem automatsko slanje izveštaja o tonerima...`);

          serverLogs.push({
            id: serverLogs.length + 1,
            timestamp: now.toISOString(),
            level: 'info',
            message: `[Scheduler] Automatski pokrenuto očitavanje i slanje izveštaja o tonerima u ${currentTime}`,
            source: 'Scheduler'
          });

          const result = await sendLowTonersAlertEmail(DEFAULT_ADMIN_RECIPIENTS);
          
          console.log(`✅ [Scheduler] Uspešno poslat automatski izveštaj u ${currentTime} na ${result.recipient} (${result.criticalCount} tonera, ${result.printersCount} štampača)`);

          serverLogs.push({
            id: serverLogs.length + 1,
            timestamp: new Date().toISOString(),
            level: 'success',
            message: `[Scheduler] Uspešno poslat automatski izveštaj u ${currentTime} na: ${result.recipient} (Status: 250 OK)`,
            source: 'Scheduler'
          });
        }
      }
    } catch (err: any) {
      console.error('❌ [Scheduler] Greška prilikom automatskog slanja:', err);
      serverLogs.push({
        id: serverLogs.length + 1,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[Scheduler] Greška prilikom automatskog slanja: ${err?.message}`,
        source: 'Scheduler'
      });
    }
  }, 10000); // Check every 10 seconds
}

export function getSchedulerStatus() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    currentTime: `${hours}:${minutes}:${seconds}`,
    activeScheduledTimes,
    days: 'Ponedeljak - Petak (Radni dani)',
    isWeekend,
    lastTriggeredMinute,
    recipients: DEFAULT_ADMIN_RECIPIENTS
  };
}

export function addScheduledTime(timeStr: string) {
  if (!activeScheduledTimes.includes(timeStr)) {
    activeScheduledTimes.push(timeStr);
  }
  return activeScheduledTimes;
}
