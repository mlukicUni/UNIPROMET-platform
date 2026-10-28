import os from 'os';

export interface NetworkAddressInfo {
  interfaceName: string;
  address: string;
  family: string;
}

export function getLocalIpAddresses(): NetworkAddressInfo[] {
  const interfaces = os.networkInterfaces();
  const addresses: NetworkAddressInfo[] = [];

  for (const [name, netInterface] of Object.entries(interfaces)) {
    if (!netInterface) continue;
    for (const net of netInterface) {
      // We are interested in IPv4 and non-internal (not 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          interfaceName: name,
          address: net.address,
          family: net.family
        });
      }
    }
  }

  return addresses;
}

export function getSystemInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsagePercent = Math.round((usedMem / totalMem) * 100);

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    uptimeSeconds: Math.floor(os.uptime()),
    nodeUptimeSeconds: Math.floor(process.uptime()),
    memory: {
      totalMB: Math.round(totalMem / (1024 * 1024)),
      usedMB: Math.round(usedMem / (1024 * 1024)),
      freeMB: Math.round(freeMem / (1024 * 1024)),
      usagePercent: memoryUsagePercent
    },
    nodeVersion: process.version
  };
}
