/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - KATALOG DOZVOLA
 * Sekcije i podsekcije platforme (prate bočni meni) sa posebnim akcijama.
 * Jedino mesto na kome se definiše šta se može dozvoliti u rolama.
 * ==========================================================================
 */

export type PermissionLevel = 'view' | 'edit';

export interface ActionDef {
  /** Kratak ključ akcije unutar podsekcije (npr. 'izvestaji'). Pun ključ je `${item.key}:${key}` */
  key: string;
  label: string;
}

export interface ItemDef {
  key: string;
  label: string;
  /** ID taba u interfejsu (data-tab) */
  tab: string;
  actions: ActionDef[];
}

export interface SectionDef {
  key: string;
  label: string;
  icon: string;
  items: ItemDef[];
}

export const PERMISSION_CATALOG: SectionDef[] = [
  {
    key: 'mreza',
    label: 'MREŽA',
    icon: 'network',
    items: [
      { key: 'mreza.racunari', label: 'Računari', tab: 'computers', actions: [] },
      { key: 'mreza.serveri', label: 'Serveri', tab: 'servers', actions: [] },
      { key: 'mreza.ostali', label: 'Ostali uređaji', tab: 'other_devices', actions: [] },
      {
        key: 'mreza.stampaci', label: 'Štampači', tab: 'printers',
        actions: [
          { key: 'izvestaji', label: 'Izveštaji potrošnje' },
          { key: 'mejl', label: 'Slanje mejlova' }
        ]
      },
      {
        key: 'mreza.kamere', label: 'Kamere (inventar)', tab: 'inventory_cameras',
        actions: [{ key: 'skeniranje', label: 'Skeniranje mreže' }]
      },
      {
        key: 'mreza.snimaci', label: 'Snimači', tab: 'inventory_recorders',
        actions: [{ key: 'sinhronizacija', label: 'Sinhronizacija kanala' }]
      },
      { key: 'mreza.rf_citaci', label: 'RF čitači', tab: 'rf_readers', actions: [] },
      {
        key: 'mreza.wifi', label: 'WiFi AP', tab: 'wifi_aps',
        actions: [{ key: 'sinhronizacija', label: 'Sinhronizacija sa kontrolerom' }]
      },
      {
        key: 'mreza.svicevi', label: 'Svičevi', tab: 'switches',
        actions: [{ key: 'skeniranje', label: 'SNMP skeniranje' }]
      }
    ]
  },
  {
    key: 'evidencija',
    label: 'EVIDENCIJA',
    icon: 'clipboard-list',
    items: [
      {
        key: 'evidencija.oprema', label: 'Računarska oprema', tab: 'equipment',
        actions: [{ key: 'izvoz', label: 'Excel izvoz' }]
      },
      {
        key: 'evidencija.mrezna_oprema', label: 'Mrežna oprema', tab: 'network_equipment',
        actions: [{ key: 'izvoz', label: 'Excel izvoz' }]
      },
      {
        key: 'evidencija.cvorista', label: 'Čvorišta', tab: 'equipment_nodes',
        actions: [{ key: 'izvoz', label: 'Excel izvoz' }]
      },
      {
        key: 'evidencija.linije', label: 'Linije', tab: 'equipment_lines',
        actions: [{ key: 'izvoz', label: 'Excel izvoz' }]
      },
      {
        key: 'evidencija.mts', label: 'MTS brojevi', tab: 'mts_numbers',
        actions: [{ key: 'izvoz', label: 'Excel izvoz' }]
      },
      { key: 'evidencija.software', label: 'Software i licence', tab: 'equipment_software', actions: [] },
      { key: 'evidencija.sifarnici', label: 'Šifarnici', tab: 'equipment_dictionaries', actions: [] }
    ]
  },
  {
    key: 'video',
    label: 'VIDEO NADZOR',
    icon: 'video',
    items: [
      { key: 'video.lista', label: 'Lista kamera', tab: 'cctv_cameras', actions: [] },
      { key: 'video.monitoring', label: 'Monitoring', tab: 'cctv_monitoring', actions: [] }
    ]
  },
  {
    key: 'noleko',
    label: 'NOLEKO AI DEVELOPMENT',
    icon: 'brain',
    items: [
      { key: 'noleko.agent_prototip', label: 'AI agent prototip', tab: 'ai_agent_prototype', actions: [] },
      { key: 'noleko.razvojni_plan', label: 'AI razvojni plan', tab: 'ai_dev_plan', actions: [] },
      { key: 'noleko.fazni_razvoj', label: 'Fazni razvoj', tab: 'ai_phased_dev', actions: [] }
    ]
  },
  {
    key: 'server',
    label: 'SERVER',
    icon: 'server',
    items: [
      { key: 'server.pregled', label: 'Pregled sistema', tab: 'dashboard', actions: [] },
      { key: 'server.servisi', label: 'Automatski servisi', tab: 'scheduled_services', actions: [] },
      { key: 'server.logovi', label: 'Sistemski logovi', tab: 'logs', actions: [] },
      { key: 'server.podesavanja', label: 'Podešavanja servera', tab: 'settings', actions: [] }
      // 'server.role' (Korisnici i role) nije u katalogu: samo Super admin
    ]
  }
];

/** Tab 'Korisnici i role' - dostupan samo Super adminu */
export const ROLES_TAB = 'access_roles';

/** Dodatni tabovi koji se mapiraju na postojeće ključeve (npr. mobilni meni) */
const EXTRA_TAB_MAP: Record<string, string> = {
  cameras: 'video.lista'
};

const itemIndex = new Map<string, ItemDef>();
const sectionIndex = new Map<string, SectionDef>();
const itemSection = new Map<string, string>();
const actionIndex = new Set<string>();
const tabToItemKey = new Map<string, string>();

for (const section of PERMISSION_CATALOG) {
  sectionIndex.set(section.key, section);
  for (const item of section.items) {
    itemIndex.set(item.key, item);
    itemSection.set(item.key, section.key);
    tabToItemKey.set(item.tab, item.key);
    for (const a of item.actions) actionIndex.add(`${item.key}:${a.key}`);
  }
}
for (const [tab, key] of Object.entries(EXTRA_TAB_MAP)) tabToItemKey.set(tab, key);

export function isSectionKey(key: string): boolean {
  return sectionIndex.has(key);
}

export function isItemKey(key: string): boolean {
  return itemIndex.has(key);
}

export function isValidPermissionKey(key: string): boolean {
  return sectionIndex.has(key) || itemIndex.has(key);
}

export function isValidActionKey(key: string): boolean {
  return actionIndex.has(key);
}

export function getSectionOfItem(itemKey: string): string | undefined {
  return itemSection.get(itemKey);
}

export function getItemsOfSection(sectionKey: string): ItemDef[] {
  return sectionIndex.get(sectionKey)?.items || [];
}

export function getItemKeyForTab(tab: string): string | undefined {
  return tabToItemKey.get(tab);
}

export function getAllItemKeys(): string[] {
  return [...itemIndex.keys()];
}

export function getAllActionKeys(): string[] {
  return [...actionIndex];
}
