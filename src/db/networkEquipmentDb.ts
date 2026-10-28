import { getDb } from './sqlite.js';

export const NETWORK_CATEGORY_IDS = [6, 7, 8, 16, 21, 22, 28, 33, 34, 39, 40, 47];

export interface NetworkEquipmentItem {
  id: number;
  category_id: number | null;
  category_name?: string | null;
  category_icon?: string | null;
  status_id: number | null;
  status_name?: string | null;
  status_color?: string | null;
  name: string;
  description?: string | null;
  comment?: string | null;
  date_arrived?: string | null;
  date_purchased?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  building_id?: number | null;
  building_name?: string | null;
  room_id?: number | null;
  room_name?: string | null;
  custom_code?: number | null;
  parent_cvor?: string | null;
  rack_dims?: string | null;
  route_desc?: string | null;
  lines_count?: number | null;
  employee_no?: string | null;
  inventory_no?: string | null;
  created_at?: string;
  updated_at?: string;
  // Attached live Navision data
  employee_name?: string | null;
  employee_job?: string | null;
  employee_dept?: string | null;
  employee_status?: string | null;
  // History
  history_count?: number;
  history?: NetworkEquipmentHistory[];
}

export interface NetworkEquipmentInput {
  id?: number;
  category_id: number | null;
  status_id?: number | null;
  name: string;
  description?: string | null;
  comment?: string | null;
  date_arrived?: string | null;
  date_purchased?: string | null;
  location_id?: number | null;
  building_id?: number | null;
  room_id?: number | null;
  custom_code?: number | null; // Cvor / parent rack
  rack_dims?: string | null;
  route_desc?: string | null;
  lines_count?: number | null;
  employee_no?: string | null;
  inventory_no?: string | null;
}

export interface NetworkEquipmentHistory {
  id: number;
  equipment_id: number;
  date?: string | null;
  note: string;
  phone?: string | null;
  created_at?: string;
}

export interface NetworkEquipmentStats {
  total: number;
  switches: number;
  routersAndAp: number;
  cvoroviAndRack: number;
  active: number;
  inService: number;
}

export interface CvorOption {
  id: number;
  name: string;
  label: string;
  location_name?: string | null;
  building_name?: string | null;
  room_name?: string | null;
  rack_dims?: string | null;
}

export const networkEquipmentDb = {
  /**
   * Retrieves KPI summary statistics for network equipment cards.
   */
  getNetworkStats(): NetworkEquipmentStats {
    const db = getDb();
    const catList = NETWORK_CATEGORY_IDS.join(',');

    const row = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN e.category_id IN (6, 47, 28) THEN 1 ELSE 0 END) AS switches,
        SUM(CASE WHEN e.category_id IN (7, 8, 22, 34, 39, 40) THEN 1 ELSE 0 END) AS routersAndAp,
        SUM(CASE WHEN e.category_id IN (16, 21, 33) OR e.rack_dims IS NOT NULL OR e.route_desc IS NOT NULL THEN 1 ELSE 0 END) AS cvoroviAndRack,
        SUM(CASE WHEN s.name LIKE '%ISPRAVNO%' OR s.name LIKE '%ISPRAVAN%' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN s.name LIKE '%SERVIS%' OR s.name LIKE '%NEISPRAVNO%' THEN 1 ELSE 0 END) AS inService
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      WHERE c.id IN (${catList})
         OR (c.is_network = 1 AND c.id NOT IN (1, 2, 4, 10))
         OR e.rack_dims IS NOT NULL
         OR e.route_desc IS NOT NULL
    `).get() as any;

    return {
      total: row?.total || 0,
      switches: row?.switches || 0,
      routersAndAp: row?.routersAndAp || 0,
      cvoroviAndRack: row?.cvoroviAndRack || 0,
      active: row?.active || 0,
      inService: row?.inService || 0
    };
  },

  /**
   * Retrieves all rack cabinets / nodes (čvorišta) for parent node dropdowns.
   */
  getAllCvorovi(): CvorOption[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        e.id, 
        e.name,
        e.rack_dims,
        l.name as location_name,
        b.name as building_name,
        r.short_desc as room_name
      FROM equipment e
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_buildings b ON e.building_id = b.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      WHERE e.category_id = 16 
         OR e.category_id = 33 
         OR e.rack_dims IS NOT NULL
         OR e.route_desc IS NOT NULL
      ORDER BY e.location_id ASC, e.building_id ASC, e.id ASC
    `).all() as any[];

    return rows.map(r => {
      const locStr = r.location_name ? `[${r.location_name}] ` : '';
      const bldStr = r.building_name ? `${r.building_name}` : '';
      const roomStr = r.room_name ? ` - ${r.room_name}` : '';
      const nameStr = r.name ? ` (${r.name})` : '';
      const label = `#${r.id} ${locStr}${bldStr}${roomStr}${nameStr}`.trim();
      return {
        id: r.id,
        name: r.name || '',
        label,
        location_name: r.location_name,
        building_name: r.building_name,
        room_name: r.room_name,
        rack_dims: r.rack_dims
      };
    });
  },

  /**
   * Retrieves paginated, filtered list of network equipment.
   */
  getNetworkEquipment(options: {
    categoryId?: number | null;
    locationId?: number | null;
    buildingId?: number | null;
    roomId?: number | null;
    statusId?: number | null;
    cvorId?: number | null;
    search?: string | null;
    matchedEmployeeNos?: string[] | null;
    limit?: number;
    offset?: number;
  }): { items: NetworkEquipmentItem[]; total: number } {
    const db = getDb();
    const catList = NETWORK_CATEGORY_IDS.join(',');

    const conditions: string[] = [
      `(c.id IN (${catList}) OR (c.is_network = 1 AND c.id NOT IN (1, 2, 4, 10)) OR e.rack_dims IS NOT NULL OR e.route_desc IS NOT NULL)`
    ];
    const params: any = {};

    if (options.categoryId) {
      conditions.push('e.category_id = @categoryId');
      params.categoryId = options.categoryId;
    }

    if (options.locationId) {
      conditions.push('e.location_id = @locationId');
      params.locationId = options.locationId;
    }

    if (options.buildingId) {
      conditions.push('e.building_id = @buildingId');
      params.buildingId = options.buildingId;
    }

    if (options.roomId) {
      conditions.push('e.room_id = @roomId');
      params.roomId = options.roomId;
    }

    if (options.statusId) {
      conditions.push('e.status_id = @statusId');
      params.statusId = options.statusId;
    }

    if (options.cvorId) {
      conditions.push('e.custom_code = @cvorId');
      params.cvorId = options.cvorId;
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
            COALESCE(e.name, '') || ' ' || 
            COALESCE(e.description, '') || ' ' || 
            COALESCE(e.comment, '') || ' ' || 
            COALESCE(e.rack_dims, '') || ' ' || 
            COALESCE(e.route_desc, '') || ' ' || 
            COALESCE(e.employee_no, '') || ' ' || 
            COALESCE(e.inventory_no, '') || ' ' || 
            COALESCE(c.name, '') || ' ' || 
            COALESCE(s.name, '') || ' ' || 
            COALESCE(l.name, '') || ' ' || 
            COALESCE(b.name, '') || ' ' || 
            COALESCE(r.short_desc, '') || ' ' ||
            COALESCE(parent_cvor.formatted, '')
          ) LIKE @${paramKey}
        )`);
      });

      const allTokensMatch = tokenConditions.length > 0 ? tokenConditions.join(' AND ') : '1=1';

      if (options.matchedEmployeeNos && options.matchedEmployeeNos.length > 0) {
        const empListStr = options.matchedEmployeeNos.map(emp => `'${emp.replace(/'/g, "''")}'`).join(',');
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
      LEFT JOIN equipment_buildings b ON e.building_id = b.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      LEFT JOIN (
        SELECT c2.id, ('#' || c2.id || ' ' || COALESCE(b2.name, '') || ' ' || COALESCE(r2.short_desc, '')) as formatted
        FROM equipment c2
        LEFT JOIN equipment_buildings b2 ON c2.building_id = b2.id
        LEFT JOIN equipment_rooms r2 ON c2.room_id = r2.id
      ) parent_cvor ON parent_cvor.id = e.custom_code
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
        e.description,
        e.comment,
        e.date_arrived,
        e.date_purchased,
        e.location_id,
        l.name AS location_name,
        e.building_id,
        b.name AS building_name,
        e.room_id,
        r.short_desc AS room_name,
        e.custom_code,
        parent_cvor.formatted AS parent_cvor,
        e.rack_dims,
        e.route_desc,
        e.lines_count,
        e.employee_no,
        e.inventory_no,
        e.created_at,
        e.updated_at,
        (SELECT COUNT(*) FROM equipment_history h WHERE h.equipment_id = e.id) AS history_count
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_buildings b ON e.building_id = b.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      LEFT JOIN (
        SELECT c2.id, ('#' || c2.id || ' ' || COALESCE(b2.name, '') || ' ' || COALESCE(r2.short_desc, '')) as formatted
        FROM equipment c2
        LEFT JOIN equipment_buildings b2 ON c2.building_id = b2.id
        LEFT JOIN equipment_rooms r2 ON c2.room_id = r2.id
      ) parent_cvor ON parent_cvor.id = e.custom_code
      ${where}
      ORDER BY e.id ASC
      LIMIT @limit OFFSET @offset;
    `).all(params) as any[];

    return {
      items: rows,
      total: countRow.total
    };
  },

  /**
   * Retrieves single network equipment by ID with history logs.
   */
  getNetworkEquipmentById(id: number): NetworkEquipmentItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        e.id,
        e.category_id,
        c.name AS category_name,
        c.icon AS category_icon,
        e.status_id,
        s.name AS status_name,
        s.color AS status_color,
        e.name,
        e.description,
        e.comment,
        e.date_arrived,
        e.date_purchased,
        e.location_id,
        l.name AS location_name,
        e.building_id,
        b.name AS building_name,
        e.room_id,
        r.short_desc AS room_name,
        e.custom_code,
        parent_cvor.formatted AS parent_cvor,
        e.rack_dims,
        e.route_desc,
        e.lines_count,
        e.employee_no,
        e.inventory_no,
        e.created_at,
        e.updated_at,
        (SELECT COUNT(*) FROM equipment_history h WHERE h.equipment_id = e.id) AS history_count
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN equipment_statuses s ON e.status_id = s.id
      LEFT JOIN equipment_locations l ON e.location_id = l.id
      LEFT JOIN equipment_buildings b ON e.building_id = b.id
      LEFT JOIN equipment_rooms r ON e.room_id = r.id
      LEFT JOIN (
        SELECT c2.id, ('#' || c2.id || ' ' || COALESCE(b2.name, '') || ' ' || COALESCE(r2.short_desc, '')) as formatted
        FROM equipment c2
        LEFT JOIN equipment_buildings b2 ON c2.building_id = b2.id
        LEFT JOIN equipment_rooms r2 ON c2.room_id = r2.id
      ) parent_cvor ON parent_cvor.id = e.custom_code
      WHERE e.id = ?
    `).get(id) as any;

    if (!row) return null;

    const history = db.prepare(`
      SELECT id, equipment_id, date, note, phone, created_at
      FROM equipment_history
      WHERE equipment_id = ?
      ORDER BY id DESC
    `).all(id) as NetworkEquipmentHistory[];

    row.history = history;
    return row;
  },

  /**
   * Creates a new network equipment record.
   */
  createNetworkEquipment(data: NetworkEquipmentInput): NetworkEquipmentItem {
    const db = getDb();
    const id = data.id || undefined;

    if (id) {
      db.prepare(`
        INSERT OR REPLACE INTO equipment (
          id, category_id, status_id, name, description, comment, date_arrived, date_purchased,
          location_id, building_id, room_id, custom_code, rack_dims, route_desc, lines_count,
          employee_no, inventory_no, updated_at
        ) VALUES (
          @id, @category_id, @status_id, @name, @description, @comment, @date_arrived, @date_purchased,
          @location_id, @building_id, @room_id, @custom_code, @rack_dims, @route_desc, @lines_count,
          @employee_no, @inventory_no, datetime('now')
        )
      `).run({
        id,
        category_id: data.category_id || 6,
        status_id: data.status_id || 1,
        name: data.name.trim(),
        description: data.description ? data.description.trim() : null,
        comment: data.comment ? data.comment.trim() : null,
        date_arrived: data.date_arrived ? data.date_arrived.trim() : null,
        date_purchased: data.date_purchased ? data.date_purchased.trim() : null,
        location_id: data.location_id || null,
        building_id: data.building_id || null,
        room_id: data.room_id || null,
        custom_code: data.custom_code || null,
        rack_dims: data.rack_dims ? data.rack_dims.trim() : null,
        route_desc: data.route_desc ? data.route_desc.trim() : null,
        lines_count: data.lines_count !== undefined && data.lines_count !== null ? Number(data.lines_count) : null,
        employee_no: data.employee_no ? data.employee_no.trim() : null,
        inventory_no: data.inventory_no ? data.inventory_no.trim() : null
      });
      return this.getNetworkEquipmentById(id)!;
    } else {
      const res = db.prepare(`
        INSERT INTO equipment (
          category_id, status_id, name, description, comment, date_arrived, date_purchased,
          location_id, building_id, room_id, custom_code, rack_dims, route_desc, lines_count,
          employee_no, inventory_no, created_at, updated_at
        ) VALUES (
          @category_id, @status_id, @name, @description, @comment, @date_arrived, @date_purchased,
          @location_id, @building_id, @room_id, @custom_code, @rack_dims, @route_desc, @lines_count,
          @employee_no, @inventory_no, datetime('now'), datetime('now')
        )
      `).run({
        category_id: data.category_id || 6,
        status_id: data.status_id || 1,
        name: data.name.trim(),
        description: data.description ? data.description.trim() : null,
        comment: data.comment ? data.comment.trim() : null,
        date_arrived: data.date_arrived ? data.date_arrived.trim() : null,
        date_purchased: data.date_purchased ? data.date_purchased.trim() : null,
        location_id: data.location_id || null,
        building_id: data.building_id || null,
        room_id: data.room_id || null,
        custom_code: data.custom_code || null,
        rack_dims: data.rack_dims ? data.rack_dims.trim() : null,
        route_desc: data.route_desc ? data.route_desc.trim() : null,
        lines_count: data.lines_count !== undefined && data.lines_count !== null ? Number(data.lines_count) : null,
        employee_no: data.employee_no ? data.employee_no.trim() : null,
        inventory_no: data.inventory_no ? data.inventory_no.trim() : null
      });
      return this.getNetworkEquipmentById(Number(res.lastInsertRowid))!;
    }
  },

  /**
   * Updates an existing network equipment item.
   */
  updateNetworkEquipment(id: number, data: Partial<NetworkEquipmentInput>): NetworkEquipmentItem | null {
    const db = getDb();
    const current = this.getNetworkEquipmentById(id);
    if (!current) return null;

    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const params: any = { id };

    if (data.name !== undefined) {
      sets.push('name = @name');
      params.name = data.name.trim();
    }
    if (data.category_id !== undefined) {
      sets.push('category_id = @category_id');
      params.category_id = data.category_id || null;
    }
    if (data.status_id !== undefined) {
      sets.push('status_id = @status_id');
      params.status_id = data.status_id || null;
    }
    if (data.description !== undefined) {
      sets.push('description = @description');
      params.description = data.description ? data.description.trim() : null;
    }
    if (data.comment !== undefined) {
      sets.push('comment = @comment');
      params.comment = data.comment ? data.comment.trim() : null;
    }
    if (data.date_arrived !== undefined) {
      sets.push('date_arrived = @date_arrived');
      params.date_arrived = data.date_arrived ? data.date_arrived.trim() : null;
    }
    if (data.date_purchased !== undefined) {
      sets.push('date_purchased = @date_purchased');
      params.date_purchased = data.date_purchased ? data.date_purchased.trim() : null;
    }
    if (data.location_id !== undefined) {
      sets.push('location_id = @location_id');
      params.location_id = data.location_id || null;
    }
    if (data.building_id !== undefined) {
      sets.push('building_id = @building_id');
      params.building_id = data.building_id || null;
    }
    if (data.room_id !== undefined) {
      sets.push('room_id = @room_id');
      params.room_id = data.room_id || null;
    }
    if (data.custom_code !== undefined) {
      sets.push('custom_code = @custom_code');
      params.custom_code = data.custom_code || null;
    }
    if (data.rack_dims !== undefined) {
      sets.push('rack_dims = @rack_dims');
      params.rack_dims = data.rack_dims ? data.rack_dims.trim() : null;
    }
    if (data.route_desc !== undefined) {
      sets.push('route_desc = @route_desc');
      params.route_desc = data.route_desc ? data.route_desc.trim() : null;
    }
    if (data.lines_count !== undefined) {
      sets.push('lines_count = @lines_count');
      params.lines_count = data.lines_count !== null ? Number(data.lines_count) : null;
    }
    if (data.employee_no !== undefined) {
      sets.push('employee_no = @employee_no');
      params.employee_no = data.employee_no ? data.employee_no.trim() : null;
    }
    if (data.inventory_no !== undefined) {
      sets.push('inventory_no = @inventory_no');
      params.inventory_no = data.inventory_no ? data.inventory_no.trim() : null;
    }

    db.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.getNetworkEquipmentById(id);
  },

  /**
   * Deletes network equipment by ID.
   */
  deleteNetworkEquipment(id: number): boolean {
    const db = getDb();
    const current = this.getNetworkEquipmentById(id);
    if (!current) return false;

    db.prepare('DELETE FROM equipment_history WHERE equipment_id = ?').run(id);
    const res = db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Adds service note / history entry.
   */
  addHistory(data: { equipment_id: number; note: string; date?: string | null; phone?: string | null }): NetworkEquipmentHistory {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO equipment_history (equipment_id, date, note, phone, created_at)
      VALUES (@equipment_id, @date, @note, @phone, datetime('now'))
    `).run({
      equipment_id: data.equipment_id,
      date: data.date ? data.date.trim() : new Date().toISOString().split('T')[0],
      note: data.note.trim(),
      phone: data.phone ? data.phone.trim() : null
    });

    const newId = Number(res.lastInsertRowid);
    return db.prepare('SELECT id, equipment_id, date, note, phone, created_at FROM equipment_history WHERE id = ?').get(newId) as NetworkEquipmentHistory;
  },

  /**
   * Deletes service note / history entry.
   */
  deleteHistory(historyId: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_history WHERE id = ?').run(historyId);
    return res.changes > 0;
  }
};
