import { getDb } from './sqlite';

export interface EquipmentCategory {
  id: number;
  name: string;
  is_network: number;
  icon: string;
  count?: number;
}

export interface EquipmentStatus {
  id: number;
  name: string;
  color: string;
}

export interface EquipmentLocation {
  id: number;
  name: string;
  usage_count?: number;
}

export interface EquipmentBuilding {
  id: number;
  name: string;
  location_id?: number | null;
  location_name?: string | null;
  code?: string | null;
  description?: string | null;
  rooms_count?: number;
  usage_count?: number;
}

export interface EquipmentRoom {
  id: number;
  code: string | null;
  building: number | null;
  building_name?: string | null;
  floor: string | null;
  short_desc: string | null;
  name: string | null;
  usage_count?: number;
}

export interface EquipmentSoftware {
  id?: number;
  equipment_id: number;
  vendor?: string | null;
  name: string;
  is_licensed?: number;
  license_key?: string | null;
  note?: string | null;
  created_at?: string;
}

export interface EquipmentHistoryItem {
  id?: number;
  equipment_id?: number;
  date?: string | null;
  note: string;
  phone?: string | null;
  created_at?: string;
}

export interface EquipmentDetails {
  id?: number;
  equipment_id: number;
  os?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  ram?: string | null;
  processor?: string | null;
  disk_type?: string | null;
  disk_capacity?: string | null;
  motherboard?: string | null;
  monitor?: string | null;
  gpu?: string | null;
  gateway?: string | null;
  cd?: string | null;
  modem?: string | null;
  speakers?: string | null;
  radio?: string | null;
  tv_card?: string | null;
}

export interface EquipmentItem {
  id: number;
  category_id: number | null;
  category_name?: string | null;
  category_icon?: string | null;
  status_id: number | null;
  status_name?: string | null;
  status_color?: string | null;
  name: string;
  date_arrived?: string | null;
  date_purchased?: string | null;
  comment?: string | null;
  group_name?: string | null;
  description?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  custom_code?: number | null;
  building_id?: number | null;
  room_id?: number | null;
  room_name?: string | null;
  rack_dims?: string | null;
  route_desc?: string | null;
  lines_count?: number | null;
  employee_no?: string | null;
  inventory_no?: string | null;
  created_at?: string;
  updated_at?: string;
  // Attached details (for computers)
  details?: EquipmentDetails | null;
  // Attached Navision data (live)
  employee_name?: string | null;
  employee_job?: string | null;
  employee_dept?: string | null;
  employee_status?: string | null;
}

export interface EquipmentInput {
  id?: number;
  category_id?: number | null;
  status_id?: number | null;
  name?: string | null;
  date_arrived?: string | null;
  date_purchased?: string | null;
  comment?: string | null;
  description?: string | null;
  location_id?: number | null;
  custom_code?: number | null;
  building_id?: number | null;
  room_id?: number | null;
  employee_no?: string | null;
  inventory_no?: string | null;
  rack_dims?: string | null;
  route_desc?: string | null;
  lines_count?: number | null;
}


export const equipmentDb = {
  /**
   * Returns categories with equipment counts for dynamic sidebar.
   */
  getCategoriesWithCounts(): EquipmentCategory[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        c.id, 
        c.name, 
        c.is_network, 
        c.icon,
        COUNT(e.id) as count
      FROM equipment_categories c
      LEFT JOIN equipment e ON c.id = e.category_id
      GROUP BY c.id, c.name, c.is_network, c.icon
      HAVING count > 0
      ORDER BY count DESC, c.name ASC;
    `).all() as EquipmentCategory[];

    return rows;
  },

  /**
   * Returns all statuses with usage counts.
   */
  getStatuses(search?: string): (EquipmentStatus & { usage_count: number })[] {
    const db = getDb();
    let query = `
      SELECT s.id, s.name, s.color, COUNT(e.id) as usage_count
      FROM equipment_statuses s
      LEFT JOIN equipment e ON s.id = e.status_id
    `;
    const params: any = {};
    if (search && search.trim()) {
      query += ' WHERE (s.name LIKE @search OR s.color LIKE @search)';
      params.search = `%${search.trim()}%`;
    }
    query += ' GROUP BY s.id, s.name, s.color ORDER BY s.id ASC;';
    return db.prepare(query).all(params) as any;
  },

  getStatusById(id: number): EquipmentStatus | null {
    const db = getDb();
    const row = db.prepare('SELECT id, name, color FROM equipment_statuses WHERE id = ?').get(id) as EquipmentStatus | undefined;
    return row || null;
  },

  createStatus(data: { id?: number; name: string; color?: string }): EquipmentStatus {
    const db = getDb();
    if (data.id) {
      db.prepare('INSERT INTO equipment_statuses (id, name, color) VALUES (@id, @name, @color)').run({
        id: data.id,
        name: data.name.trim(),
        color: (data.color || 'gray').trim()
      });
      return this.getStatusById(data.id)!;
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_statuses').get() as { maxId: number | null };
      const nextId = (maxRow?.maxId || 0) + 1;
      db.prepare('INSERT INTO equipment_statuses (id, name, color) VALUES (@id, @name, @color)').run({
        id: nextId,
        name: data.name.trim(),
        color: (data.color || 'gray').trim()
      });
      return this.getStatusById(nextId)!;
    }
  },

  updateStatus(id: number, data: { name?: string; color?: string }): EquipmentStatus | null {
    const db = getDb();
    const current = this.getStatusById(id);
    if (!current) return null;

    db.prepare('UPDATE equipment_statuses SET name = @name, color = @color WHERE id = @id').run({
      id,
      name: data.name !== undefined ? data.name.trim() : current.name,
      color: data.color !== undefined ? data.color.trim() : current.color
    });
    return this.getStatusById(id);
  },

  deleteStatus(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_statuses WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Returns all categories with usage counts.
   */
  getAllCategories(search?: string): (EquipmentCategory & { usage_count: number })[] {
    const db = getDb();
    let query = `
      SELECT c.id, c.name, c.is_network, c.icon, COUNT(e.id) as usage_count
      FROM equipment_categories c
      LEFT JOIN equipment e ON c.id = e.category_id
    `;
    const params: any = {};
    if (search && search.trim()) {
      query += ' WHERE (c.name LIKE @search OR c.icon LIKE @search)';
      params.search = `%${search.trim()}%`;
    }
    query += ' GROUP BY c.id, c.name, c.is_network, c.icon ORDER BY c.id ASC;';
    return db.prepare(query).all(params) as any;
  },

  getCategoryById(id: number): EquipmentCategory | null {
    const db = getDb();
    const row = db.prepare('SELECT id, name, is_network, icon FROM equipment_categories WHERE id = ?').get(id) as EquipmentCategory | undefined;
    return row || null;
  },

  createCategory(data: { id?: number; name: string; is_network?: number; icon?: string }): EquipmentCategory {
    const db = getDb();
    if (data.id) {
      db.prepare('INSERT INTO equipment_categories (id, name, is_network, icon) VALUES (@id, @name, @is_network, @icon)').run({
        id: data.id,
        name: data.name.trim(),
        is_network: data.is_network ? 1 : 0,
        icon: (data.icon || 'package').trim()
      });
      return this.getCategoryById(data.id)!;
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_categories').get() as { maxId: number | null };
      const nextId = (maxRow?.maxId || 0) + 1;
      db.prepare('INSERT INTO equipment_categories (id, name, is_network, icon) VALUES (@id, @name, @is_network, @icon)').run({
        id: nextId,
        name: data.name.trim(),
        is_network: data.is_network ? 1 : 0,
        icon: (data.icon || 'package').trim()
      });
      return this.getCategoryById(nextId)!;
    }
  },

  updateCategory(id: number, data: { name?: string; is_network?: number; icon?: string }): EquipmentCategory | null {
    const db = getDb();
    const current = this.getCategoryById(id);
    if (!current) return null;

    db.prepare('UPDATE equipment_categories SET name = @name, is_network = @is_network, icon = @icon WHERE id = @id').run({
      id,
      name: data.name !== undefined ? data.name.trim() : current.name,
      is_network: data.is_network !== undefined ? (data.is_network ? 1 : 0) : current.is_network,
      icon: data.icon !== undefined ? data.icon.trim() : current.icon
    });
    return this.getCategoryById(id);
  },

  deleteCategory(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_categories WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Returns all locations with usage counts.
   */
  getLocations(search?: string): (EquipmentLocation & { usage_count: number })[] {
    const db = getDb();
    let query = `
      SELECT l.id, l.name, COUNT(e.id) as usage_count
      FROM equipment_locations l
      LEFT JOIN equipment e ON l.id = e.location_id
    `;
    const params: any = {};
    if (search && search.trim()) {
      query += ' WHERE l.name LIKE @search';
      params.search = `%${search.trim()}%`;
    }
    query += ' GROUP BY l.id, l.name ORDER BY l.id ASC;';
    return db.prepare(query).all(params) as any;
  },

  getLocationById(id: number): EquipmentLocation | null {
    const db = getDb();
    const row = db.prepare('SELECT id, name FROM equipment_locations WHERE id = ?').get(id) as EquipmentLocation | undefined;
    return row || null;
  },

  createLocation(data: { id?: number; name: string }): EquipmentLocation {
    const db = getDb();
    if (data.id) {
      db.prepare('INSERT INTO equipment_locations (id, name) VALUES (@id, @name)').run({
        id: data.id,
        name: data.name.trim()
      });
      return this.getLocationById(data.id)!;
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_locations').get() as { maxId: number | null };
      const nextId = (maxRow?.maxId || 0) + 1;
      db.prepare('INSERT INTO equipment_locations (id, name) VALUES (@id, @name)').run({
        id: nextId,
        name: data.name.trim()
      });
      return this.getLocationById(nextId)!;
    }
  },

  updateLocation(id: number, data: { name: string }): EquipmentLocation | null {
    const db = getDb();
    const current = this.getLocationById(id);
    if (!current) return null;

    db.prepare('UPDATE equipment_locations SET name = @name WHERE id = @id').run({
      id,
      name: data.name.trim()
    });
    return this.getLocationById(id);
  },

  deleteLocation(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_locations WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Returns all buildings (objekti) with room and equipment counts.
   */
  getBuildings(search?: string): (EquipmentBuilding & { rooms_count: number; usage_count: number })[] {
    const db = getDb();
    let query = `
      SELECT 
        b.id, 
        b.name, 
        b.location_id, 
        l.name AS location_name, 
        b.code, 
        b.description,
        COUNT(DISTINCT r.id) AS rooms_count,
        COUNT(DISTINCT e.id) AS usage_count
      FROM equipment_buildings b
      LEFT JOIN equipment_locations l ON b.location_id = l.id
      LEFT JOIN equipment_rooms r ON b.id = r.building
      LEFT JOIN equipment e ON b.id = e.building_id
    `;
    const params: any = {};
    if (search && search.trim()) {
      query += ' WHERE (b.name LIKE @search OR b.code LIKE @search OR b.description LIKE @search OR l.name LIKE @search)';
      params.search = `%${search.trim()}%`;
    }
    query += ' GROUP BY b.id, b.name, b.location_id, l.name, b.code, b.description ORDER BY b.id ASC;';
    return db.prepare(query).all(params) as any;
  },

  getBuildingById(id: number): EquipmentBuilding | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT b.id, b.name, b.location_id, l.name AS location_name, b.code, b.description
      FROM equipment_buildings b
      LEFT JOIN equipment_locations l ON b.location_id = l.id
      WHERE b.id = ?
    `).get(id) as EquipmentBuilding | undefined;
    return row || null;
  },

  createBuilding(data: { id?: number; name: string; location_id?: number | null; code?: string | null; description?: string | null }): EquipmentBuilding {
    const db = getDb();
    if (data.id) {
      db.prepare(`
        INSERT INTO equipment_buildings (id, name, location_id, code, description)
        VALUES (@id, @name, @location_id, @code, @description)
      `).run({
        id: data.id,
        name: data.name.trim(),
        location_id: data.location_id || null,
        code: data.code ? data.code.trim() : null,
        description: data.description ? data.description.trim() : null
      });
      return this.getBuildingById(data.id)!;
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_buildings').get() as { maxId: number | null };
      const nextId = (maxRow?.maxId || 0) + 1;
      db.prepare(`
        INSERT INTO equipment_buildings (id, name, location_id, code, description)
        VALUES (@id, @name, @location_id, @code, @description)
      `).run({
        id: nextId,
        name: data.name.trim(),
        location_id: data.location_id || null,
        code: data.code ? data.code.trim() : null,
        description: data.description ? data.description.trim() : null
      });
      return this.getBuildingById(nextId)!;
    }
  },

  updateBuilding(id: number, data: { name?: string; location_id?: number | null; code?: string | null; description?: string | null }): EquipmentBuilding | null {
    const db = getDb();
    const current = this.getBuildingById(id);
    if (!current) return null;

    db.prepare(`
      UPDATE equipment_buildings 
      SET name = @name, location_id = @location_id, code = @code, description = @description
      WHERE id = @id
    `).run({
      id,
      name: data.name !== undefined ? data.name.trim() : current.name,
      location_id: data.location_id !== undefined ? (data.location_id || null) : current.location_id,
      code: data.code !== undefined ? (data.code ? data.code.trim() : null) : current.code,
      description: data.description !== undefined ? (data.description ? data.description.trim() : null) : current.description
    });
    return this.getBuildingById(id);
  },

  deleteBuilding(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_buildings WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Returns all rooms (kancelarije) joined with building details.
   */
  getRooms(search?: string, buildingId?: number | null): (EquipmentRoom & { usage_count: number })[] {
    const db = getDb();
    let query = `
      SELECT 
        r.id, 
        r.code, 
        r.building, 
        b.name AS building_name, 
        r.floor, 
        r.short_desc, 
        r.name,
        COUNT(e.id) AS usage_count
      FROM equipment_rooms r
      LEFT JOIN equipment_buildings b ON r.building = b.id
      LEFT JOIN equipment e ON r.id = e.room_id
    `;
    const conditions: string[] = [];
    const params: any = {};

    if (buildingId) {
      conditions.push('r.building = @buildingId');
      params.buildingId = buildingId;
    }

    if (search && search.trim()) {
      conditions.push('(r.code LIKE @search OR r.name LIKE @search OR r.short_desc LIKE @search OR r.floor LIKE @search OR b.name LIKE @search)');
      params.search = `%${search.trim()}%`;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' GROUP BY r.id, r.code, r.building, b.name, r.floor, r.short_desc, r.name ORDER BY b.name ASC, r.code ASC, r.id ASC;';
    return db.prepare(query).all(params) as any;
  },

  getRoomById(id: number): EquipmentRoom | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        r.id, 
        r.code, 
        r.building, 
        b.name AS building_name, 
        r.floor, 
        r.short_desc, 
        r.name
      FROM equipment_rooms r
      LEFT JOIN equipment_buildings b ON r.building = b.id
      WHERE r.id = ?
    `).get(id) as EquipmentRoom | undefined;
    return row || null;
  },

  createRoom(data: { id?: number; code?: string | null; building?: number | null; floor?: string | null; short_desc?: string | null; name?: string | null }): EquipmentRoom {
    const db = getDb();
    if (data.id) {
      db.prepare(`
        INSERT INTO equipment_rooms (id, code, building, floor, short_desc, name)
        VALUES (@id, @code, @building, @floor, @short_desc, @name)
      `).run({
        id: data.id,
        code: data.code ? data.code.trim() : null,
        building: data.building || null,
        floor: data.floor ? data.floor.trim() : null,
        short_desc: data.short_desc ? data.short_desc.trim() : null,
        name: data.name ? data.name.trim() : null
      });
      return this.getRoomById(data.id)!;
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_rooms').get() as { maxId: number | null };
      const nextId = (maxRow?.maxId || 0) + 1;
      db.prepare(`
        INSERT INTO equipment_rooms (id, code, building, floor, short_desc, name)
        VALUES (@id, @code, @building, @floor, @short_desc, @name)
      `).run({
        id: nextId,
        code: data.code ? data.code.trim() : null,
        building: data.building || null,
        floor: data.floor ? data.floor.trim() : null,
        short_desc: data.short_desc ? data.short_desc.trim() : null,
        name: data.name ? data.name.trim() : null
      });
      return this.getRoomById(nextId)!;
    }
  },

  updateRoom(id: number, data: { code?: string | null; building?: number | null; floor?: string | null; short_desc?: string | null; name?: string | null }): EquipmentRoom | null {
    const db = getDb();
    const current = this.getRoomById(id);
    if (!current) return null;

    db.prepare(`
      UPDATE equipment_rooms
      SET code = @code, building = @building, floor = @floor, short_desc = @short_desc, name = @name
      WHERE id = @id
    `).run({
      id,
      code: data.code !== undefined ? (data.code ? data.code.trim() : null) : current.code,
      building: data.building !== undefined ? (data.building || null) : current.building,
      floor: data.floor !== undefined ? (data.floor ? data.floor.trim() : null) : current.floor,
      short_desc: data.short_desc !== undefined ? (data.short_desc ? data.short_desc.trim() : null) : current.short_desc,
      name: data.name !== undefined ? (data.name ? data.name.trim() : null) : current.name
    });
    return this.getRoomById(id);
  },

  deleteRoom(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_rooms WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Returns all codebooks (statuses, locations, buildings, rooms, categories).
   */
  getCodebooks() {
    return {
      statuses: this.getStatuses(),
      locations: this.getLocations(),
      buildings: this.getBuildings(),
      rooms: this.getRooms(),
      categories: this.getCategoriesWithCounts()
    };
  },

  /**
   * Returns KPI summary statistics for dashboard cards.
   */
  getKPIStats() {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN employee_no IS NOT NULL AND TRIM(employee_no) != '' THEN 1 ELSE 0 END) AS inUse,
        SUM(CASE WHEN (employee_no IS NULL OR TRIM(employee_no) = '') AND (s.name LIKE '%ISPRAVNO%' OR s.name LIKE '%ISPRAVAN%') THEN 1 ELSE 0 END) AS inReserve,
        SUM(CASE WHEN s.name LIKE '%SERVIS%' OR s.name LIKE '%NEISPRAVNO%' OR s.name LIKE '%NEISPRAVAN%' THEN 1 ELSE 0 END) AS inService,
        SUM(CASE WHEN e.category_id IN (1, 2) THEN 1 ELSE 0 END) AS computers,
        SUM(CASE WHEN e.category_id IN (3, 4) THEN 1 ELSE 0 END) AS printers,
        SUM(CASE WHEN e.category_id NOT IN (1, 2, 3, 4) OR e.category_id IS NULL THEN 1 ELSE 0 END) AS other
      FROM equipment e
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
    `).get() as any;

    return {
      total: row?.total || 0,
      inUse: row?.inUse || 0,
      inReserve: row?.inReserve || 0,
      inService: row?.inService || 0,
      computers: row?.computers || 0,
      printers: row?.printers || 0,
      other: row?.other || 0
    };
  },

  /**
   * Returns KPI summary statistics (total, in_use, in_reserve, in_service).
   */
  getStats(categoryId?: number | null) {
    const db = getDb();
    let whereClause = '';
    const params: any = {};

    if (categoryId) {
      whereClause = 'WHERE category_id = @catId';
      params.catId = categoryId;
    }

    const row = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN employee_no IS NOT NULL AND TRIM(employee_no) != '' THEN 1 ELSE 0 END) AS in_use,
        SUM(CASE WHEN (employee_no IS NULL OR TRIM(employee_no) = '') AND (s.name LIKE '%ISPRAVNO%' OR s.name LIKE '%ISPRAVAN%') THEN 1 ELSE 0 END) AS in_reserve,
        SUM(CASE WHEN s.name LIKE '%SERVIS%' OR s.name LIKE '%NEISPRAVNO%' OR s.name LIKE '%NEISPRAVAN%' THEN 1 ELSE 0 END) AS in_service
      FROM equipment e
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      ${whereClause}
    `).get(params) as any;

    return {
      total: row?.total || 0,
      in_use: row?.in_use || 0,
      in_reserve: row?.in_reserve || 0,
      in_service: row?.in_service || 0
    };
  },

  /**
   * High-level paginated equipment list helper.
   */
  getEquipmentList(
    filters: {
      categoryId?: number | null;
      statusId?: number | null;
      statusGroup?: 'service' | 'in_use' | 'in_reserve' | 'all' | null;
      locationId?: number | null;
      search?: string | null;
      employeeNos?: string[] | null;
    },
    pagination: {
      page: number;
      pageSize: number;
    }
  ) {
    const page = Math.max(1, pagination.page || 1);
    const pageSize = Math.max(1, pagination.pageSize || 50);
    const offset = (page - 1) * pageSize;

    const res = this.getEquipment({
      categoryId: filters.categoryId,
      statusId: filters.statusId,
      statusGroup: filters.statusGroup,
      locationId: filters.locationId,
      search: filters.search,
      employeeNos: filters.employeeNos,
      limit: pageSize,
      offset
    });

    return {
      items: res.items,
      total: res.total,
      page,
      pageSize,
      totalPages: Math.ceil(res.total / pageSize) || 1
    };
  },


  /**
   * Queries equipment with filtering, search, and pagination.
   */
  getEquipment(options: {
    categoryId?: number | null;
    statusId?: number | null;
    statusGroup?: 'service' | 'in_use' | 'in_reserve' | 'all' | null;
    locationId?: number | null;
    search?: string | null;
    employeeNos?: string[] | null;
    limit?: number;
    offset?: number;
  }): { items: EquipmentItem[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: any = {};

    if (options.categoryId) {
      conditions.push('e.category_id = @categoryId');
      params.categoryId = options.categoryId;
    }

    if (options.statusId) {
      conditions.push('e.status_id = @statusId');
      params.statusId = options.statusId;
    }

    if (options.statusGroup) {
      if (options.statusGroup === 'service') {
        conditions.push("(s.name LIKE '%SERVIS%' OR s.name LIKE '%NEISPRAVNO%' OR s.name LIKE '%NEISPRAVAN%')");
      } else if (options.statusGroup === 'in_use') {
        conditions.push("(e.employee_no IS NOT NULL AND TRIM(e.employee_no) != '' AND UPPER(TRIM(e.employee_no)) != 'BEZ')");
      } else if (options.statusGroup === 'in_reserve') {
        conditions.push("((e.employee_no IS NULL OR TRIM(e.employee_no) = '' OR UPPER(TRIM(e.employee_no)) = 'BEZ') AND (s.name LIKE '%ISPRAVNO%' OR s.name LIKE '%ISPRAVAN%'))");
      }
    }

    if (options.locationId) {
      conditions.push('e.location_id = @locationId');
      params.locationId = options.locationId;
    }

    if (options.search && options.search.trim()) {
      const trimmedSearch = options.search.trim();
      const tokens = trimmedSearch.toLowerCase().split(/\s+/).filter(Boolean);

      const tokenConditions: string[] = [];
      tokens.forEach((tok, i) => {
        const paramKey = `tok_${i}`;
        params[paramKey] = `%${tok}%`;
        tokenConditions.push(`(
          LOWER(
            '#' || CAST(e.id AS TEXT) || ' ' || 
            CAST(e.id AS TEXT) || ' ' || 
            COALESCE(e.name, '') || ' ' || 
            COALESCE(e.employee_no, '') || ' ' || 
            COALESCE(e.inventory_no, '') || ' ' || 
            COALESCE(e.custom_code, '') || ' ' || 
            COALESCE(e.description, '') || ' ' || 
            COALESCE(e.comment, '') || ' ' || 
            COALESCE(e.date_purchased, '') || ' ' || 
            COALESCE(c.name, '') || ' ' || 
            COALESCE(s.name, '') || ' ' || 
            COALESCE(l.name, '') || ' ' || 
            COALESCE(r.name, '') || ' ' || 
            COALESCE(d.processor, '') || ' ' || 
            COALESCE(d.ram, '') || ' ' || 
            COALESCE(d.ip_address, '') || ' ' || 
            COALESCE(d.mac_address, '') || ' ' || 
            COALESCE(d.os, '')
          ) LIKE @${paramKey}
        )`);
      });

      const allTokensMatch = tokenConditions.length > 0 ? tokenConditions.join(' AND ') : '1=1';

      if (options.employeeNos && options.employeeNos.length > 0) {
        const empListStr = options.employeeNos.map(emp => `'${emp.replace(/'/g, "''")}'`).join(',');
        conditions.push(`((${allTokensMatch}) OR e.employee_no IN (${empListStr}))`);
      } else {
        conditions.push(`(${allTokensMatch})`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`
      SELECT COUNT(DISTINCT e.id) as total
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      LEFT JOIN equipment_details d ON e.id = d.equipment_id
      ${where}
    `).get(params) as { total: number };

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    params.limit = limit;
    params.offset = offset;

    const rows = db.prepare(`
      SELECT 
        e.id, 
        e.category_id, 
        c.name AS category_name, 
        c.icon AS category_icon,
        e.status_id, 
        s.name AS status_name, 
        s.color AS status_color,
        e.name, 
        e.date_arrived, 
        e.date_purchased, 
        e.comment, 
        e.group_name, 
        e.description, 
        e.location_id, 
        l.name AS location_name,
        e.custom_code, 
        e.building_id, 
        e.room_id, 
        r.name AS room_name,
        e.rack_dims, 
        e.route_desc, 
        e.lines_count, 
        e.employee_no, 
        e.inventory_no,
        e.created_at, 
        e.updated_at,
        d.processor,
        d.ram,
        d.ip_address,
        d.mac_address,
        d.disk_type,
        d.disk_capacity,
        d.motherboard,
        d.os
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      LEFT JOIN equipment_details d ON e.id = d.equipment_id
      ${where}
      ORDER BY e.id DESC
      LIMIT @limit OFFSET @offset;
    `).all(params) as any[];

    const items: EquipmentItem[] = rows.map(r => {
      const hasDetails = r.processor || r.ram || r.ip_address || r.mac_address || r.motherboard || r.os;
      return {
        id: r.id,
        category_id: r.category_id,
        category_name: r.category_name,
        category_icon: r.category_icon,
        status_id: r.status_id,
        status_name: r.status_name,
        status_color: r.status_color,
        name: r.name,
        date_arrived: r.date_arrived,
        date_purchased: r.date_purchased,
        comment: r.comment,
        group_name: r.group_name,
        description: r.description,
        location_id: r.location_id,
        location_name: r.location_name,
        custom_code: r.custom_code,
        building_id: r.building_id,
        room_id: r.room_id,
        room_name: r.room_name,
        rack_dims: r.rack_dims,
        route_desc: r.route_desc,
        lines_count: r.lines_count,
        employee_no: r.employee_no,
        inventory_no: r.inventory_no,
        created_at: r.created_at,
        updated_at: r.updated_at,
        details: hasDetails ? {
          equipment_id: r.id,
          processor: r.processor,
          ram: r.ram,
          ip_address: r.ip_address,
          mac_address: r.mac_address,
          disk_type: r.disk_type,
          disk_capacity: r.disk_capacity,
          motherboard: r.motherboard,
          os: r.os
        } : null
      };
    });

    return { items, total: countRow.total };
  },

  /**
   * Retrieves single equipment item with full details, history, and software.
   */
  getEquipmentById(id: number) {
    const db = getDb();
    const item = db.prepare(`
      SELECT 
        e.id, 
        e.category_id, 
        c.name AS category_name, 
        c.icon AS category_icon,
        e.status_id, 
        s.name AS status_name, 
        s.color AS status_color,
        e.name, 
        e.date_arrived, 
        e.date_purchased, 
        e.comment, 
        e.group_name, 
        e.description, 
        e.location_id, 
        l.name AS location_name,
        e.custom_code, 
        e.building_id, 
        e.room_id, 
        r.name AS room_name,
        e.rack_dims, 
        e.route_desc, 
        e.lines_count, 
        e.employee_no, 
        e.inventory_no,
        e.created_at, 
        e.updated_at
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      WHERE e.id = ?
    `).get(id) as any;

    if (!item) return null;

    const details = db.prepare('SELECT * FROM equipment_details WHERE equipment_id = ?').get(id) as EquipmentDetails | undefined;
    const history = db.prepare('SELECT * FROM equipment_history WHERE equipment_id = ? ORDER BY date DESC, id DESC').all(id) as any[];
    const software = db.prepare('SELECT * FROM equipment_software WHERE equipment_id = ? ORDER BY name ASC').all(id) as any[];

    return {
      ...item,
      details: details || null,
      history: history || [],
      software: software || []
    };
  },

  /**
   * Creates a new equipment record.
   * If explicitId is provided (e.g. from MS SQL sequence), uses it; otherwise generates next ID.
   * If details are provided (for computers/laptops), inserts them atomically.
   * If software list is provided, inserts each software item.
   */
  createEquipment(data: EquipmentInput, details?: Partial<EquipmentDetails> | null, explicitId?: number, softwareList?: Partial<EquipmentSoftware>[], historyList?: EquipmentHistoryItem[]): number {
    const db = getDb();
    const targetId = explicitId || data.id;

    const insertStmt = db.prepare(`
      INSERT INTO equipment (
        ${targetId ? 'id,' : ''}
        category_id, status_id, name, date_arrived, date_purchased,
        comment, description, location_id, custom_code, building_id,
        room_id, employee_no, inventory_no, rack_dims, route_desc, lines_count, created_at, updated_at
      ) VALUES (
        ${targetId ? '@id,' : ''}
        @category_id, @status_id, @name, @date_arrived, @date_purchased,
        @comment, @description, @location_id, @custom_code, @building_id,
        @room_id, @employee_no, @inventory_no, @rack_dims, @route_desc, @lines_count, datetime('now'), datetime('now')
      )
    `);

    const insertDetailsStmt = db.prepare(`
      INSERT OR REPLACE INTO equipment_details (
        equipment_id, os, ip_address, mac_address, ram, processor,
        disk_type, disk_capacity, motherboard, monitor, gpu, gateway,
        created_at, updated_at
      ) VALUES (
        @equipment_id, @os, @ip_address, @mac_address, @ram, @processor,
        @disk_type, @disk_capacity, @motherboard, @monitor, @gpu, @gateway,
        datetime('now'), datetime('now')
      )
    `);

    const insertSoftwareStmt = db.prepare(`
      INSERT INTO equipment_software (
        equipment_id, vendor, name, is_licensed, license_key, note, created_at
      ) VALUES (
        @equipment_id, @vendor, @name, @is_licensed, @license_key, @note, datetime('now')
      )
    `);

    let newId = targetId || 0;

    const createTx = db.transaction(() => {
      const res = insertStmt.run({
        id: targetId || undefined,
        category_id: data.category_id || null,
        status_id: data.status_id || null,
        name: data.name ? data.name.trim() : '',
        date_arrived: data.date_arrived || null,
        date_purchased: data.date_purchased || null,
        comment: data.comment || null,
        description: data.description || null,
        location_id: data.location_id || null,
        custom_code: data.custom_code || null,
        building_id: data.building_id || null,
        room_id: data.room_id || null,
        employee_no: data.employee_no ? data.employee_no.trim() : null,
        inventory_no: data.inventory_no ? data.inventory_no.trim() : null,
        rack_dims: data.rack_dims ? data.rack_dims.trim() : null,
        route_desc: data.route_desc ? data.route_desc.trim() : null,
        lines_count: data.lines_count !== undefined && data.lines_count !== null ? Number(data.lines_count) : null
      });

      if (!targetId) {
        newId = Number(res.lastInsertRowid);
      }

      if (details) {
        insertDetailsStmt.run({
          equipment_id: newId,
          os: details.os || null,
          ip_address: details.ip_address || null,
          mac_address: details.mac_address || null,
          ram: details.ram || null,
          processor: details.processor || null,
          disk_type: details.disk_type || null,
          disk_capacity: details.disk_capacity || null,
          motherboard: details.motherboard || null,
          monitor: details.monitor || null,
          gpu: details.gpu || null,
          gateway: details.gateway || null
        });
      }

      if (softwareList && Array.isArray(softwareList) && softwareList.length > 0) {
        for (const s of softwareList) {
          if (s.name && s.name.trim()) {
            insertSoftwareStmt.run({
              equipment_id: newId,
              vendor: s.vendor ? s.vendor.trim() : null,
              name: s.name.trim(),
              is_licensed: s.is_licensed !== undefined ? s.is_licensed : 1,
              license_key: s.license_key ? s.license_key.trim() : null,
              note: s.note ? s.note.trim() : null
            });
          }
        }
      }

      if (historyList && Array.isArray(historyList) && historyList.length > 0) {
        const insertHistStmt = db.prepare(`
          INSERT INTO equipment_history (
            equipment_id, date, note, phone, created_at
          ) VALUES (
            @equipment_id, @date, @note, @phone, datetime('now')
          )
        `);
        for (const h of historyList) {
          if (h.note && h.note.trim()) {
            insertHistStmt.run({
              equipment_id: newId,
              date: h.date || new Date().toISOString().split('T')[0],
              note: h.note.trim(),
              phone: h.phone ? h.phone.trim() : null
            });
          }
        }
      }
    });

    createTx();
    return newId;
  },

  /**
   * Updates an existing equipment item, optional details, software list and history notes.
   */
  updateEquipment(id: number, data: Partial<EquipmentInput>, details?: Partial<EquipmentDetails> | null, softwareList?: Partial<EquipmentSoftware>[], historyList?: EquipmentHistoryItem[]) {
    const db = getDb();

    const updateTx = db.transaction(() => {
      const fields: string[] = ["updated_at = datetime('now')"];
      const params: any = { id };

      if (data.name !== undefined) { fields.push('name = @name'); params.name = data.name ? data.name.trim() : ''; }
      if (data.category_id !== undefined) { fields.push('category_id = @category_id'); params.category_id = data.category_id; }
      if (data.status_id !== undefined) { fields.push('status_id = @status_id'); params.status_id = data.status_id; }
      if (data.employee_no !== undefined) { fields.push('employee_no = @employee_no'); params.employee_no = data.employee_no ? data.employee_no.trim() : null; }
      if (data.inventory_no !== undefined) { fields.push('inventory_no = @inventory_no'); params.inventory_no = data.inventory_no ? data.inventory_no.trim() : null; }
      if (data.location_id !== undefined) { fields.push('location_id = @location_id'); params.location_id = data.location_id; }
      if (data.building_id !== undefined) { fields.push('building_id = @building_id'); params.building_id = data.building_id; }
      if (data.room_id !== undefined) { fields.push('room_id = @room_id'); params.room_id = data.room_id; }
      if (data.custom_code !== undefined) { fields.push('custom_code = @custom_code'); params.custom_code = data.custom_code; }
      if (data.rack_dims !== undefined) { fields.push('rack_dims = @rack_dims'); params.rack_dims = data.rack_dims ? data.rack_dims.trim() : null; }
      if (data.route_desc !== undefined) { fields.push('route_desc = @route_desc'); params.route_desc = data.route_desc ? data.route_desc.trim() : null; }
      if (data.lines_count !== undefined) { fields.push('lines_count = @lines_count'); params.lines_count = data.lines_count !== null ? Number(data.lines_count) : null; }
      if (data.description !== undefined) { fields.push('description = @description'); params.description = data.description; }
      if (data.comment !== undefined) { fields.push('comment = @comment'); params.comment = data.comment; }
      if (data.date_arrived !== undefined) { fields.push('date_arrived = @date_arrived'); params.date_arrived = data.date_arrived; }
      if (data.date_purchased !== undefined) { fields.push('date_purchased = @date_purchased'); params.date_purchased = data.date_purchased; }

      db.prepare(`UPDATE equipment SET ${fields.join(', ')} WHERE id = @id`).run(params);


      if (details !== undefined && details !== null) {
        db.prepare(`
          INSERT INTO equipment_details (
            equipment_id, os, ip_address, mac_address, ram, processor,
            disk_type, disk_capacity, motherboard, gpu, gateway, updated_at
          ) VALUES (
            @id, @os, @ip_address, @mac_address, @ram, @processor,
            @disk_type, @disk_capacity, @motherboard, @gpu, @gateway, datetime('now')
          )
          ON CONFLICT(equipment_id) DO UPDATE SET
            os = COALESCE(@os, os),
            ip_address = COALESCE(@ip_address, ip_address),
            mac_address = COALESCE(@mac_address, mac_address),
            ram = COALESCE(@ram, ram),
            processor = COALESCE(@processor, processor),
            disk_type = COALESCE(@disk_type, disk_type),
            disk_capacity = COALESCE(@disk_capacity, disk_capacity),
            motherboard = COALESCE(@motherboard, motherboard),
            gpu = COALESCE(@gpu, gpu),
            gateway = COALESCE(@gateway, gateway),
            updated_at = datetime('now')
        `).run({
          id,
          os: details.os || null,
          ip_address: details.ip_address || null,
          mac_address: details.mac_address || null,
          ram: details.ram || null,
          processor: details.processor || null,
          disk_type: details.disk_type || null,
          disk_capacity: details.disk_capacity || null,
          motherboard: details.motherboard || null,
          gpu: details.gpu || null,
          gateway: details.gateway || null
        });
      }

      if (softwareList !== undefined && Array.isArray(softwareList)) {
        db.prepare('DELETE FROM equipment_software WHERE equipment_id = ?').run(id);
        const insertSoft = db.prepare(`
          INSERT INTO equipment_software (
            equipment_id, vendor, name, is_licensed, license_key, note, created_at
          ) VALUES (
            @equipment_id, @vendor, @name, @is_licensed, @license_key, @note, datetime('now')
          )
        `);
        for (const s of softwareList) {
          if (s.name && s.name.trim()) {
            insertSoft.run({
              equipment_id: id,
              vendor: s.vendor ? s.vendor.trim() : null,
              name: s.name.trim(),
              is_licensed: s.is_licensed !== undefined ? s.is_licensed : 1,
              license_key: s.license_key ? s.license_key.trim() : null,
              note: s.note ? s.note.trim() : null
            });
          }
        }
      }

      if (historyList !== undefined && Array.isArray(historyList)) {
        const incomingIds = historyList.filter(h => h.id && Number(h.id) > 0).map(h => Number(h.id));
        
        if (incomingIds.length > 0) {
          const placeholders = incomingIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM equipment_history WHERE equipment_id = ? AND id NOT IN (${placeholders})`).run(id, ...incomingIds);
        } else {
          db.prepare('DELETE FROM equipment_history WHERE equipment_id = ?').run(id);
        }

        const updateHistStmt = db.prepare(`
          UPDATE equipment_history 
          SET note = @note, date = @date, phone = @phone 
          WHERE id = @id AND equipment_id = @equipment_id
        `);

        const insertHistStmt = db.prepare(`
          INSERT INTO equipment_history (
            equipment_id, date, note, phone, created_at
          ) VALUES (
            @equipment_id, @date, @note, @phone, datetime('now')
          )
        `);

        for (const h of historyList) {
          if (h.note && h.note.trim()) {
            if (h.id && incomingIds.includes(Number(h.id))) {
              updateHistStmt.run({
                id: Number(h.id),
                equipment_id: id,
                note: h.note.trim(),
                date: h.date || new Date().toISOString().split('T')[0],
                phone: h.phone ? h.phone.trim() : null
              });
            } else {
              insertHistStmt.run({
                equipment_id: id,
                note: h.note.trim(),
                date: h.date || new Date().toISOString().split('T')[0],
                phone: h.phone ? h.phone.trim() : null
              });
            }
          }
        }
      }
    });

    updateTx();
    return this.getEquipmentById(id);
  },

  /**
   * Deletes an equipment item (cascades to details, history, software).
   */
  deleteEquipment(id: number) {
    const db = getDb();
    return db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
  },

  /**
   * Adds a new service / assignment history entry for an equipment item.
   */
  addEquipmentHistory(equipmentId: number, note: string, date?: string | null, phone?: string | null, explicitId?: number) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO equipment_history (
        ${explicitId ? 'id,' : ''}
        equipment_id, date, note, phone, created_at
      ) VALUES (
        ${explicitId ? '@id,' : ''}
        @equipment_id, @date, @note, @phone, datetime('now')
      )
    `);

    const res = stmt.run({
      id: explicitId || undefined,
      equipment_id: equipmentId,
      date: date || new Date().toISOString().split('T')[0],
      note: note.trim(),
      phone: phone ? phone.trim() : null
    });

    return explicitId || Number(res.lastInsertRowid);
  },

  /**
   * Updates an existing history entry.
   */
  updateEquipmentHistory(historyId: number, note: string, date?: string | null, phone?: string | null) {
    const db = getDb();
    return db.prepare(`
      UPDATE equipment_history
      SET note = @note,
          date = COALESCE(@date, date),
          phone = @phone
      WHERE id = @id
    `).run({
      id: historyId,
      note: note.trim(),
      date: date || null,
      phone: phone ? phone.trim() : null
    });
  },

  /**
   * Deletes a single history entry by ID.
   */
  deleteEquipmentHistory(historyId: number) {
    const db = getDb();
    return db.prepare('DELETE FROM equipment_history WHERE id = ?').run(historyId);
  },

  /**
   * Adds a single software license entry to an equipment item.
   */
  addEquipmentSoftware(equipmentId: number, software: Partial<EquipmentSoftware>) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO equipment_software (
        equipment_id, vendor, name, is_licensed, license_key, note, created_at
      ) VALUES (
        @equipment_id, @vendor, @name, @is_licensed, @license_key, @note, datetime('now')
      )
    `);

    const res = stmt.run({
      equipment_id: equipmentId,
      vendor: software.vendor ? software.vendor.trim() : null,
      name: (software.name || '').trim(),
      is_licensed: software.is_licensed !== undefined ? software.is_licensed : 1,
      license_key: software.license_key ? software.license_key.trim() : null,
      note: software.note ? software.note.trim() : null
    });

    return Number(res.lastInsertRowid);
  },

  /**
   * Deletes a single software entry by ID.
   */
  deleteEquipmentSoftware(id: number) {
    const db = getDb();
    return db.prepare('DELETE FROM equipment_software WHERE id = ?').run(id);
  },

  /**
   * Updates an existing software entry by ID.
   */
  updateEquipmentSoftware(id: number, software: Partial<EquipmentSoftware>) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM equipment_software WHERE id = ?').get(id) as EquipmentSoftware | undefined;
    if (!existing) return false;

    const stmt = db.prepare(`
      UPDATE equipment_software SET
        equipment_id = @equipment_id,
        vendor = @vendor,
        name = @name,
        is_licensed = @is_licensed,
        license_key = @license_key,
        note = @note
      WHERE id = @id
    `);

    stmt.run({
      id,
      equipment_id: software.equipment_id !== undefined ? software.equipment_id : existing.equipment_id,
      vendor: software.vendor !== undefined ? (software.vendor ? software.vendor.trim() : null) : existing.vendor,
      name: software.name !== undefined ? (software.name || '').trim() : existing.name,
      is_licensed: software.is_licensed !== undefined ? software.is_licensed : existing.is_licensed,
      license_key: software.license_key !== undefined ? (software.license_key ? software.license_key.trim() : null) : existing.license_key,
      note: software.note !== undefined ? (software.note ? software.note.trim() : null) : existing.note
    });

    return true;
  },

  /**
   * Retrieves a single software license by ID with equipment metadata.
   */
  getSoftwareById(id: number) {
    const db = getDb();
    return db.prepare(`
      SELECT 
        s.*,
        e.name as equipment_name,
        e.inventory_no as equipment_inv_no,
        e.custom_code as equipment_custom_code,
        e.employee_no as equipment_employee_no,
        d.ip_address as equipment_ip
      FROM equipment_software s
      LEFT JOIN equipment e ON s.equipment_id = e.id
      LEFT JOIN equipment_details d ON e.id = d.equipment_id
      WHERE s.id = ?
    `).get(id) as any;
  },

  /**
   * Retrieves high-level software license statistics for KPI cards.
   */
  getSoftwareStats() {
    const db = getDb();
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_licensed = 1 THEN 1 ELSE 0 END) as licensed,
        SUM(CASE WHEN is_licensed = 0 THEN 1 ELSE 0 END) as unlicensed,
        COUNT(DISTINCT equipment_id) as unique_equipment
      FROM equipment_software
    `).get() as { total: number; licensed: number; unlicensed: number; unique_equipment: number };

    return {
      total: stats.total || 0,
      licensed: stats.licensed || 0,
      unlicensed: stats.unlicensed || 0,
      unique_equipment: stats.unique_equipment || 0
    };
  },

  /**
   * Retrieves unique vendors with counts for quick filter pills.
   */
  getSoftwareVendors() {
    const db = getDb();
    return db.prepare(`
      SELECT 
        CASE 
          WHEN vendor IS NULL OR TRIM(vendor) = '' THEN 'Nespecificirano'
          ELSE TRIM(vendor)
        END as vendor,
        COUNT(*) as count
      FROM equipment_software
      GROUP BY 
        CASE 
          WHEN vendor IS NULL OR TRIM(vendor) = '' THEN 'Nespecificirano'
          ELSE UPPER(TRIM(vendor))
        END
      ORDER BY count DESC
    `).all() as { vendor: string; count: number }[];
  },

  /**
   * Retrieves all software licenses with equipment details, filters, search and pagination.
   */
  getAllSoftware(options: {
    search?: string;
    vendor?: string;
    is_licensed?: number | null;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  } = {}) {
    const db = getDb();
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = options.pageSize && options.pageSize > 0 ? Number(options.pageSize) : 50;
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      conditions.push(`(
        s.name LIKE @q OR 
        s.vendor LIKE @q OR 
        s.license_key LIKE @q OR 
        s.note LIKE @q OR 
        e.name LIKE @q OR 
        e.inventory_no LIKE @q OR 
        e.employee_no LIKE @q OR
        d.ip_address LIKE @q
      )`);
      params.q = q;
    }

    if (options.vendor && options.vendor.trim() && options.vendor.toUpperCase() !== 'ALL') {
      const v = options.vendor.trim();
      if (v.toUpperCase() === 'OTHER' || v.toUpperCase() === 'OSTALO') {
        conditions.push(`(
          s.vendor IS NULL OR 
          TRIM(s.vendor) = '' OR 
          UPPER(TRIM(s.vendor)) NOT IN ('MS', 'MICROSOFT', 'AUTODESK', 'ADOBE', 'COREL', 'EUMETSAT')
        )`);
      } else if (v.toUpperCase() === 'NESPECIFICIRANO') {
        conditions.push(`(s.vendor IS NULL OR TRIM(s.vendor) = '')`);
      } else {
        conditions.push(`UPPER(TRIM(s.vendor)) = UPPER(@vendor)`);
        params.vendor = v;
      }
    }

    if (options.is_licensed !== undefined && options.is_licensed !== null) {
      conditions.push(`s.is_licensed = @is_licensed`);
      params.is_licensed = options.is_licensed;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching
    const countQuery = `
      SELECT COUNT(*) as total
      FROM equipment_software s
      LEFT JOIN equipment e ON s.equipment_id = e.id
      LEFT JOIN equipment_details d ON e.id = d.equipment_id
      ${whereClause}
    `;
    const countRow = db.prepare(countQuery).get(params) as { total: number };
    const total = countRow ? countRow.total : 0;

    // Determine sorting
    const validSortCols: Record<string, string> = {
      id: 's.id',
      name: 's.name',
      vendor: 's.vendor',
      is_licensed: 's.is_licensed',
      equipment_name: 'e.name',
      license_key: 's.license_key',
      created_at: 's.created_at'
    };

    const sortBy = options.sortBy && validSortCols[options.sortBy] ? validSortCols[options.sortBy] : 's.id';
    const sortOrder = options.sortOrder && options.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataQuery = `
      SELECT 
        s.id,
        s.equipment_id,
        s.vendor,
        s.name,
        s.is_licensed,
        s.license_key,
        s.note,
        s.created_at,
        e.name as equipment_name,
        e.inventory_no as equipment_inv_no,
        e.custom_code as equipment_custom_code,
        e.employee_no as equipment_employee_no,
        d.ip_address as equipment_ip,
        d.os as equipment_os
      FROM equipment_software s
      LEFT JOIN equipment e ON s.equipment_id = e.id
      LEFT JOIN equipment_details d ON e.id = d.equipment_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT @pageSize OFFSET @offset
    `;

    const items = db.prepare(dataQuery).all({
      ...params,
      pageSize,
      offset
    }) as any[];

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }
};
