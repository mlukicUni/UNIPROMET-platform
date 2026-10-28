import { 
  getAllScheduledServices, 
  getScheduledServiceById, 
  updateServiceLastRun, 
  ScheduledServiceRecord 
} from '../db/scheduledServicesDb';
import { 
  sendLowTonersAlertEmail, 
  sendUrgentTonerAlertEmail,
  sendOfflineCamerasAlertEmail, 
  sendOfflineRfReadersAlertEmail,
  sendOfflineWifiApsAlertEmail,
  sendOfflineRecordersAlertEmail 
} from './mailService';
import { checkUrgentTonersAndWaste } from './snmpService';
import { checkScheduledInventoryCameras } from './cameraScanner';
import { pingAllRfReaders } from '../db/rfReaderDb';
import { syncAndCheckWifiAps } from '../db/wifiApDb';
import { checkAllRecordersStatus } from './recorderScanner';
import { serverLogs } from '../routes/api';
import { getAzureSecretExpiry, sendAzureSecretExpiryEmail } from './secretExpiryService';

let schedulerInterval: NodeJS.Timeout | null = null;
const lastTriggeredKeys = new Set<string>();

/**
 * Executes an individual scheduled service task
 */
export async function executeService(service: ScheduledServiceRecord, manual = false): Promise<any> {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
  const triggerPrefix = manual ? '[Ručno Pokretanje]' : `[Termin ${timeStr}]`;

  console.log(`\n⏰ [UnifiedScheduler] ${triggerPrefix} Izvršavam servis: "${service.name}" (${service.service_key})...`);

  serverLogs.push({
    id: serverLogs.length + 1,
    timestamp: now.toISOString(),
    level: 'info',
    message: `${triggerPrefix} Pokrenut servis: ${service.name}`,
    source: 'Scheduler'
  });

  try {
    // 1. Hourly Urgent Toner & Waste Alerts Service
    if (service.service_key === 'urgent_toner_alerts') {
      const urgentData = await checkUrgentTonersAndWaste(true);
      const urgentCount = urgentData.urgentPrintersCount || 0;

      if (urgentCount > 0) {
        const result = await sendUrgentTonerAlertEmail(service.recipients, urgentData);
        const msg = `Detektovano ${urgentCount} štampača sa hitnim statusom (Puni waste kontejneri: ${urgentData.totalWasteFullCount}, Kolor toneri na 0%: ${urgentData.totalZeroColorTonersCount}). Email upozorenja uspešno poslat na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;

        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, urgentCount, details: result };
      } else {
        const msg = `Svi štampači (${urgentData.totalPrinters}) su uredni. Nema prepunjenih waste kontejnera niti kolor tonera na 0%. Nema potrebe za slanjem emaila.`;
        updateServiceLastRun(service.id, 'Sve uredno (0 hitnih)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `${triggerPrefix} ${service.name}: ${msg}`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, urgentCount: 0, message: msg };
      }
    }

    // 2. Standard Daily Toner Alerts Service (07:00h)
    if (service.service_key === 'toner_alerts' || (service.target_type === 'printers' && service.service_key !== 'urgent_toner_alerts')) {
      const result = await sendLowTonersAlertEmail(service.recipients);
      const msg = `Poslat izveštaj o ${result.criticalCount} kritičnih tonera na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;
      
      updateServiceLastRun(service.id, 'Uspešno (250 OK)', msg);
      
      serverLogs.push({
        id: serverLogs.length + 1,
        timestamp: new Date().toISOString(),
        level: 'success',
        message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
        source: 'Scheduler'
      });

      return { success: true, serviceName: service.name, details: result };
    } 
    
    if (service.target_type === 'cameras' || service.service_key === 'camera_offline_alerts') {
      const offlineData = await checkScheduledInventoryCameras();
      const offlineCount = offlineData.offlineCount || 0;

      if (offlineCount > 0) {
        const result = await sendOfflineCamerasAlertEmail(service.recipients, offlineData);
        const msg = `Detektovano ${offlineCount} offline kamera. Email upozorenja uspešno poslat na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;
        
        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount, details: result };
      } else {
        const msg = `Sve kamere (${offlineData.inventoryTotalCount}) su online na mreži. Nema potrebe za slanjem emaila.`;
        updateServiceLastRun(service.id, 'Sve online (Uredno)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `${triggerPrefix} ${service.name}: ${msg}`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount: 0, message: msg };
      }
    }

    if (service.target_type === 'rf_readers' || service.service_key === 'rf_reader_alerts') {
      const readers = await pingAllRfReaders();
      const offlineReaders = readers.filter(r => r.status === 'offline');
      const offlineCount = offlineReaders.length;
      const totalCount = readers.length;

      if (offlineCount > 0) {
        const result = await sendOfflineRfReadersAlertEmail(service.recipients, {
          offlineReaders,
          totalReaders: totalCount
        });
        const msg = `Detektovano ${offlineCount} offline RF čitača (${totalCount} ukupno). Email upozorenja poslat na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;
        
        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount, totalCount, details: result };
      } else {
        const msg = `Svi RF čitači (${totalCount}) su online na mreži. Nema potrebe za slanjem emaila.`;
        updateServiceLastRun(service.id, 'Svi online (Uredno)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `${triggerPrefix} ${service.name}: ${msg}`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount: 0, totalCount, message: msg };
      }
    }

    if (service.target_type === 'wifi_aps' || service.service_key === 'wifi_ap_alerts') {
      const { allAps, offlineAps, totalAps, offlineCount } = await syncAndCheckWifiAps();

      if (offlineCount > 0) {
        const result = await sendOfflineWifiApsAlertEmail(service.recipients, {
          offlineAps,
          totalAps
        });
        const msg = `Detektovano ${offlineCount} offline WiFi AP uređaja (${totalAps} ukupno). Email upozorenja poslat na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;
        
        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount, totalAps, details: result };
      } else {
        const msg = `Svih ${totalAps} WiFi pristupnih tačaka (Aruba AP) je online i u funkciji. Nema potrebe za slanjem emaila.`;
        updateServiceLastRun(service.id, 'Svi online (Uredno)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `${triggerPrefix} ${service.name}: ${msg}`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount: 0, totalAps, message: msg };
      }
    }

    if (service.target_type === 'recorders' || service.service_key === 'recorder_offline_alerts') {
      const { allRecorders, offlineRecorders, total, offlineCount } = await checkAllRecordersStatus();

      if (offlineCount > 0) {
        const result = await sendOfflineRecordersAlertEmail(service.recipients, {
          offlineRecorders,
          total
        });
        const msg = `Detektovano ${offlineCount} offline NVR snimača (${total} ukupno). Email upozorenja poslat na: ${Array.isArray(service.recipients) ? service.recipients.join(', ') : service.recipients}`;
        
        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `${triggerPrefix} ${msg} (Status: 250 OK)`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount, total, details: result };
      } else {
        const msg = `Svih ${total} NVR/DVR video snimača je online i WebUI je dostupan. Nema potrebe za slanjem emaila.`;
        updateServiceLastRun(service.id, 'Svi online (Uredno)', msg);

        serverLogs.push({
          id: serverLogs.length + 1,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `${triggerPrefix} ${service.name}: ${msg}`,
          source: 'Scheduler'
        });

        return { success: true, serviceName: service.name, offlineCount: 0, total, message: msg };
      }
    }

    // Azure client secret expiry: email dan pre isteka i svakog jutra kada je istekao
    if (service.service_key === 'azure_secret_expiry') {
      const status = getAzureSecretExpiry();

      if (!status.configured) {
        const msg = 'Datum isteka nije podešen: dodajte AZURE_CLIENT_SECRET_EXPIRES=YYYY-MM-DD u .env i restartujte server.';
        updateServiceLastRun(service.id, 'Nije podešeno', msg);
        serverLogs.push({ id: serverLogs.length + 1, timestamp: new Date().toISOString(), level: 'warn', message: `${triggerPrefix} ${service.name}: ${msg}`, source: 'Scheduler' });
        return { success: false, serviceName: service.name, message: msg };
      }

      if (status.daysLeft <= 1) {
        const result = await sendAzureSecretExpiryEmail(service.recipients, status);
        const when = status.daysLeft === 1 ? 'ističe sutra' : status.daysLeft === 0 ? 'ističe danas' : 'je istekao';
        const msg = `Azure ključ ${when} (${status.expiresOnDisplay}). Email upozorenja poslat na: ${service.recipients.join(', ')}`;
        updateServiceLastRun(service.id, 'Upozorenje poslato (250 OK)', msg);
        serverLogs.push({ id: serverLogs.length + 1, timestamp: new Date().toISOString(), level: 'warn', message: `${triggerPrefix} ${msg}`, source: 'Scheduler' });
        return { success: true, serviceName: service.name, daysLeft: status.daysLeft, details: result };
      }

      const msg = `Azure ključ važi još ${status.daysLeft} dana (ističe ${status.expiresOnDisplay}). Upozorenje se šalje dan pre isteka.`;
      updateServiceLastRun(service.id, 'Uredno', msg);
      serverLogs.push({ id: serverLogs.length + 1, timestamp: new Date().toISOString(), level: 'info', message: `${triggerPrefix} ${service.name}: ${msg}`, source: 'Scheduler' });
      return { success: true, serviceName: service.name, daysLeft: status.daysLeft, message: msg };
    }

    // Default fallback
    const msg = `Servis ${service.name} je uspešno proveren.`;
    updateServiceLastRun(service.id, 'Izvršeno', msg);
    return { success: true, message: msg };
  } catch (err: any) {
    const errorMsg = `Greška pri izvršavanju servisa ${service.name}: ${err?.message}`;
    console.error('❌ [UnifiedScheduler]', errorMsg, err);
    updateServiceLastRun(service.id, 'Greška', errorMsg);

    serverLogs.push({
      id: serverLogs.length + 1,
      timestamp: new Date().toISOString(),
      level: 'error',
      message: errorMsg,
      source: 'Scheduler'
    });

    throw err;
  }
}

/**
 * Initializes unified dynamic scheduler engine
 */
export function initUnifiedScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log('[UnifiedScheduler] ⏰ Pokrenut objedinjeni mehanizam automatskih servisa (SQLite integracija)');

  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${hours}:${minutes}`;

      const allServices = getAllScheduledServices();

      for (const service of allServices) {
        if (!service.is_enabled) continue;

        // Skip weekends if service is marked as weekdays only
        if (service.weekdays_only && isWeekend) continue;

        // Check if current minute matches any configured activation time
        if (service.cron_times.includes(currentTime)) {
          const triggerKey = `${service.id}_${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${currentTime}`;

          if (!lastTriggeredKeys.has(triggerKey)) {
            lastTriggeredKeys.add(triggerKey);

            // Keep triggerKeys set clean and bounded
            if (lastTriggeredKeys.size > 200) {
              lastTriggeredKeys.clear();
              lastTriggeredKeys.add(triggerKey);
            }

            // Execute service task asynchronously
            executeService(service, false).catch(err => {
              console.error(`Greška pri automatskom izvršavanju servisa ${service.name}:`, err);
            });
          }
        }
      }
    } catch (err: any) {
      console.error('❌ [UnifiedScheduler] Greška u scheduler petlji:', err);
    }
  }, 3000); // Check every 3 seconds
}

/**
 * Triggers a service immediately on user demand
 */
export async function runServiceNow(serviceId: string): Promise<any> {
  const service = getScheduledServiceById(serviceId);
  if (!service) {
    throw new Error(`Servis sa ID '${serviceId}' nije pronađen.`);
  }

  return await executeService(service, true);
}
