/**
 * Global Network Scan Mutex / Concurrency Controller
 * Ensures that heavy network scans (Cameras, Workstations, Recorders, Fleet Toners)
 * never run concurrently across WAN links or local switches.
 *
 * - Različita skeniranja idu jedno po jedno, redom kojim su tražena (FIFO red).
 * - Isto skeniranje (isto ime) pokrenuto dok već traje priključuje se postojećem, ne radi se dvaput.
 * - fallbackOnBusy: ako drugo skeniranje radi ili čeka u redu, odmah vraća rezervni rezultat (npr. keš).
 * - Zadatak pod lockom ne sme da poziva drugo skeniranje pod lockom (čekao bi sam sebe).
 */

let activeScan: string | null = null;
let pendingCount = 0;
let queueTail: Promise<void> = Promise.resolve();
const inflight = new Map<string, Promise<unknown>>();

export async function acquireScanLock<T>(
  scanName: string,
  task: () => Promise<T>,
  fallbackOnBusy?: () => Promise<T> | T
): Promise<T> {
  // Same scan already running or queued: join it instead of starting a duplicate
  const running = inflight.get(scanName);
  if (running) {
    return running as Promise<T>;
  }

  // Another scan is running or waiting: caller prefers an immediate fallback
  if (fallbackOnBusy && (activeScan !== null || pendingCount > 0)) {
    return fallbackOnBusy();
  }

  pendingCount++;
  const run = queueTail.then(async () => {
    pendingCount--;
    activeScan = scanName;
    try {
      return await task();
    } finally {
      activeScan = null;
    }
  });
  inflight.set(scanName, run);
  queueTail = run.then(() => undefined, () => undefined);

  try {
    return await run;
  } finally {
    if (inflight.get(scanName) === run) {
      inflight.delete(scanName);
    }
  }
}

export function isAnyScanActive(): boolean {
  return activeScan !== null;
}

export function getActiveScanName(): string | null {
  return activeScan;
}
