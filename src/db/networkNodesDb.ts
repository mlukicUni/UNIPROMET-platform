import { getDb } from './sqlite.js';
import { initSchema } from './schema.js';

initSchema();

export interface NetworkNodeItem {
  id: number;
  name: string;
  category_id: number;
  category_name?: string;
  status_id: number;
  status_name?: string;
  location_id: number | null;
  location_name?: string | null;
  building_id: number | null;
  building_name?: string | null;
  room_id: number | null;
  room_name?: string | null;
  room_floor?: string | null;
  rack_dims: string | null;
  route_desc: string | null;
  lines_count: number | null;
  custom_code: number | null;
  parent_node_name?: string | null;
  comment: string | null;
  description: string | null;
  employee_no: string | null;
  employee_name?: string | null;
  employee_job?: string | null;
  employee_dept?: string | null;
  employee_status?: string | null;
  inventory_no: string | null;
  date_arrived: string | null;
  date_purchased: string | null;
  created_at: string;
  updated_at: string;

  // Enriched relationships
  connected_devices_count?: number;
  connected_devices_list?: Array<{
    id: number;
    name: string;
    category_name: string;
    status_name: string;
    employee_name?: string | null;
  }>;
  connected_lines_count?: number;
  connected_lines_list?: Array<{
    id: number;
    wall_socket_no: number | null;
    patch_panel_code: string | null;
    room_name: string | null;
    room_floor: string | null;
    building_name: string | null;
  }>;
  history_count?: number;
  history?: Array<{
    id: number;
    date: string | null;
    note: string;
    phone: string | null;
  }>;
}

export interface NetworkNodeInput {
  name?: string;
  category_id?: number; // 16 = CVOR, 33 = RACK
  status_id?: number;
  location_id?: number | null;
  building_id?: number | null;
  room_id?: number | null;
  rack_dims?: string | null;
  route_desc?: string | null;
  lines_count?: number | null;
  custom_code?: number | null; // Upstream / Parent Čvor ID
  comment?: string | null;
  description?: string | null;
  employee_no?: string | null;
  inventory_no?: string | null;
  date_arrived?: string | null;
  date_purchased?: string | null;
}

export interface NetworkNodesStats {
  total: number;
  rackCabinets: number;
  distributionNodes: number;
  activeNodes: number;
  totalConfiguredLines: number;
}

export class NetworkNodesDb {
  /**
   * Returns summary statistics for Nodes tab KPI cards
   */
  getStats(): NetworkNodesStats {
    const db = getDb();

    const totalRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM equipment 
      WHERE category_id IN (16, 33)
    `).get() as { count: number };

    const rackRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM equipment 
      WHERE category_id = 33 OR (rack_dims IS NOT NULL AND trim(rack_dims) != '' AND trim(rack_dims) != 'NEMA')
    `).get() as { count: number };

    const distRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM equipment 
      WHERE category_id = 16
    `).get() as { count: number };

    const activeRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM equipment 
      WHERE category_id IN (16, 33) AND status_id IN (1, 2)
    `).get() as { count: number };

    const linesSumRow = db.prepare(`
      SELECT SUM(lines_count) as total 
      FROM equipment 
      WHERE category_id IN (16, 33) AND lines_count > 0
    `).get() as { total: number | null };

    return {
      total: totalRow?.count || 0,
      rackCabinets: rackRow?.count || 0,
      distributionNodes: distRow?.count || 0,
      activeNodes: activeRow?.count || 0,
      totalConfiguredLines: linesSumRow?.total || 0
    };
  }

  /**
   * Lists nodes with multi-criteria filters, joined locations, and device/line counts
   */
  getNodes(options: {
    page?: number;
    limit?: number;
    search?: string;
    locationId?: number;
    buildingId?: number;
    roomId?: number;
    categoryId?: number;
    statusId?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }): { items: NetworkNodeItem[]; total: number } {
    const db = getDb();
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(500, options.limit || 50));
    const offset = (page - 1) * limit;

    let whereClauses: string[] = ['e.category_id IN (16, 33)'];
    let params: Record<string, any> = {};

    if (options.locationId) {
      whereClauses.push('e.location_id = @locationId');
      params.locationId = options.locationId;
    }

    if (options.buildingId) {
      whereClauses.push('e.building_id = @buildingId');
      params.buildingId = options.buildingId;
    }

    if (options.roomId) {
      whereClauses.push('e.room_id = @roomId');
      params.roomId = options.roomId;
    }

    if (options.categoryId) {
      whereClauses.push('e.category_id = @categoryId');
      params.categoryId = options.categoryId;
    }

    if (options.statusId) {
      whereClauses.push('e.status_id = @statusId');
      params.statusId = options.statusId;
    }

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      params.q = q;
      whereClauses.push(`(
        CAST(e.id AS TEXT) LIKE @q
        OR e.name LIKE @q
        OR e.description LIKE @q
        OR e.rack_dims LIKE @q
        OR e.route_desc LIKE @q
        OR e.comment LIKE @q
        OR e.employee_no LIKE @q
        OR e.inventory_no LIKE @q
        OR loc.name LIKE @q
        OR bld.name LIKE @q
        OR rm.name LIKE @q
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const validSortCols: Record<string, string> = {
      id: 'e.id',
      name: 'e.name',
      location_name: 'loc.name',
      building_name: 'bld.name',
      room_name: 'rm.name',
      lines_count: 'e.lines_count',
      status_id: 'e.status_id'
    };

    const sortBy = validSortCols[options.sortBy || 'id'] || 'e.id';
    const sortOrder = options.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    const countSql = `
      SELECT COUNT(*) as total
      FROM equipment e
      LEFT JOIN equipment_locations loc ON e.location_id = loc.id
      LEFT JOIN equipment_buildings bld ON e.building_id = bld.id
      LEFT JOIN equipment_rooms rm ON e.room_id = rm.id
      ${whereSql}
    `;

    const totalRow = db.prepare(countSql).get(params) as { total: number };
    const total = totalRow?.total || 0;

    const dataSql = `
      SELECT 
        e.id,
        COALESCE(NULLIF(trim(e.name), ''), NULLIF(trim(e.description), ''), 'Čvor #' || e.id) as name,
        e.category_id,
        cat.name as category_name,
        e.status_id,
        st.name as status_name,
        e.location_id,
        loc.name as location_name,
        e.building_id,
        bld.name as building_name,
        e.room_id,
        rm.name as room_name,
        rm.floor as room_floor,
        e.rack_dims,
        e.route_desc,
        e.lines_count,
        e.custom_code,
        e.comment,
        e.description,
        e.employee_no,
        e.inventory_no,
        e.date_arrived,
        e.date_purchased,
        e.created_at,
        e.updated_at,
        parent_node.name as parent_node_name
      FROM equipment e
      LEFT JOIN equipment_categories cat ON e.category_id = cat.id
      LEFT JOIN equipment_statuses st ON e.status_id = st.id
      LEFT JOIN equipment_locations loc ON e.location_id = loc.id
      LEFT JOIN equipment_buildings bld ON e.building_id = bld.id
      LEFT JOIN equipment_rooms rm ON e.room_id = rm.id
      LEFT JOIN equipment parent_node ON e.custom_code = parent_node.id
      ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT @limit OFFSET @offset
    `;

    const rows = db.prepare(dataSql).all({ ...params, limit, offset }) as any[];

    const nodeIds = rows.map(r => r.id);
    const devicesCountMap = new Map<number, number>();
    const linesCountMap = new Map<number, number>();
    const historyCountMap = new Map<number, number>();

    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => '?').join(',');

      // Count devices connected to these nodes (custom_code)
      const devCounts = db.prepare(`
        SELECT custom_code as node_id, COUNT(*) as cnt 
        FROM equipment 
        WHERE custom_code IN (${placeholders}) AND status_id != 5
        GROUP BY custom_code
      `).all(nodeIds) as Array<{ node_id: number; cnt: number }>;
      for (const d of devCounts) devicesCountMap.set(d.node_id, d.cnt);

      // Count lines connected to these nodes in equipment_lines
      const lineCounts = db.prepare(`
        SELECT cvor_id as node_id, COUNT(*) as cnt 
        FROM equipment_lines 
        WHERE cvor_id IN (${placeholders})
        GROUP BY cvor_id
      `).all(nodeIds) as Array<{ node_id: number; cnt: number }>;
      for (const l of lineCounts) linesCountMap.set(l.node_id, l.cnt);

      // Count history logs
      const histCounts = db.prepare(`
        SELECT equipment_id as node_id, COUNT(*) as cnt 
        FROM equipment_history 
        WHERE equipment_id IN (${placeholders})
        GROUP BY equipment_id
      `).all(nodeIds) as Array<{ node_id: number; cnt: number }>;
      for (const h of histCounts) historyCountMap.set(h.node_id, h.cnt);
    }

    const items: NetworkNodeItem[] = rows.map(r => ({
      ...r,
      connected_devices_count: devicesCountMap.get(r.id) || 0,
      connected_lines_count: linesCountMap.get(r.id) || 0,
      history_count: historyCountMap.get(r.id) || 0
    }));

    return { items, total };
  }

  /**
   * Retrieves single node with full hierarchy, connected devices, lines, and service logs
   */
  getNodeById(id: number): NetworkNodeItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        e.id,
        COALESCE(NULLIF(trim(e.name), ''), NULLIF(trim(e.description), ''), 'Čvor #' || e.id) as name,
        e.category_id,
        cat.name as category_name,
        e.status_id,
        st.name as status_name,
        e.location_id,
        loc.name as location_name,
        e.building_id,
        bld.name as building_name,
        e.room_id,
        rm.name as room_name,
        rm.floor as room_floor,
        e.rack_dims,
        e.route_desc,
        e.lines_count,
        e.custom_code,
        e.comment,
        e.description,
        e.employee_no,
        e.inventory_no,
        e.date_arrived,
        e.date_purchased,
        e.created_at,
        e.updated_at,
        parent_node.name as parent_node_name
      FROM equipment e
      LEFT JOIN equipment_categories cat ON e.category_id = cat.id
      LEFT JOIN equipment_statuses st ON e.status_id = st.id
      LEFT JOIN equipment_locations loc ON e.location_id = loc.id
      LEFT JOIN equipment_buildings bld ON e.building_id = bld.id
      LEFT JOIN equipment_rooms rm ON e.room_id = rm.id
      LEFT JOIN equipment parent_node ON e.custom_code = parent_node.id
      WHERE e.id = ?
    `).get(id) as any;

    if (!row) return null;

    // Fetch connected devices (switches, routers, servers)
    const devices = db.prepare(`
      SELECT 
        e.id, 
        e.name, 
        cat.name as category_name,
        st.name as status_name,
        e.employee_no
      FROM equipment e
      LEFT JOIN equipment_categories cat ON e.category_id = cat.id
      LEFT JOIN equipment_statuses st ON e.status_id = st.id
      WHERE e.custom_code = ? AND e.status_id != 5
      ORDER BY e.category_id ASC, e.name ASC
    `).all(id) as any[];
    row.connected_devices_list = devices;
    row.connected_devices_count = devices.length;

    // Fetch connected lines
    const lines = db.prepare(`
      SELECT 
        l.id,
        l.wall_socket_no,
        l.patch_panel_code,
        r.name as room_name,
        r.floor as room_floor,
        b.name as building_name
      FROM equipment_lines l
      LEFT JOIN equipment_rooms r ON l.room_id = r.id
      LEFT JOIN equipment_buildings b ON r.building = b.id
      WHERE l.cvor_id = ?
      ORDER BY l.wall_socket_no ASC, l.id ASC
    `).all(id) as any[];
    row.connected_lines_list = lines;
    row.connected_lines_count = lines.length;

    // Fetch service history
    const history = db.prepare(`
      SELECT id, date, note, phone 
      FROM equipment_history 
      WHERE equipment_id = ? 
      ORDER BY date DESC, id DESC
    `).all(id) as any[];
    row.history = history;
    row.history_count = history.length;

    return row as NetworkNodeItem;
  }

  /**
   * Creates a new Čvorište / Rack item
   */
  createNode(input: NetworkNodeInput): NetworkNodeItem {
    const db = getDb();
    const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment').get() as { maxId: number | null };
    const nextId = (maxRow?.maxId || 0) + 1;

    db.prepare(`
      INSERT INTO equipment (
        id, category_id, status_id, name, location_id, building_id, room_id,
        rack_dims, route_desc, lines_count, custom_code, comment, description,
        employee_no, inventory_no, date_arrived, date_purchased, created_at, updated_at
      ) VALUES (
        @id, @category_id, @status_id, @name, @location_id, @building_id, @room_id,
        @rack_dims, @route_desc, @lines_count, @custom_code, @comment, @description,
        @employee_no, @inventory_no, @date_arrived, @date_purchased, datetime('now'), datetime('now')
      )
    `).run({
      id: nextId,
      category_id: input.category_id || 16, // Default: CVOR #16
      status_id: input.status_id || 1, // Default: ISPRAVNO #1
      name: input.name ? input.name.trim() : `Čvor #${nextId}`,
      location_id: input.location_id || null,
      building_id: input.building_id || null,
      room_id: input.room_id || null,
      rack_dims: input.rack_dims ? input.rack_dims.trim() : null,
      route_desc: input.route_desc ? input.route_desc.trim() : null,
      lines_count: input.lines_count !== undefined && input.lines_count !== null ? Number(input.lines_count) : null,
      custom_code: input.custom_code || null,
      comment: input.comment ? input.comment.trim() : null,
      description: input.description ? input.description.trim() : null,
      employee_no: input.employee_no ? input.employee_no.trim() : null,
      inventory_no: input.inventory_no ? input.inventory_no.trim() : null,
      date_arrived: input.date_arrived ? input.date_arrived.trim() : null,
      date_purchased: input.date_purchased ? input.date_purchased.trim() : null
    });

    return this.getNodeById(nextId)!;
  }

  /**
   * Updates an existing Čvorište / Rack item
   */
  updateNode(id: number, input: NetworkNodeInput): NetworkNodeItem | null {
    const db = getDb();
    const existing = this.getNodeById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE equipment
      SET 
        name = @name,
        category_id = @category_id,
        status_id = @status_id,
        location_id = @location_id,
        building_id = @building_id,
        room_id = @room_id,
        rack_dims = @rack_dims,
        route_desc = @route_desc,
        lines_count = @lines_count,
        custom_code = @custom_code,
        comment = @comment,
        description = @description,
        employee_no = @employee_no,
        inventory_no = @inventory_no,
        date_arrived = @date_arrived,
        date_purchased = @date_purchased,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      name: input.name !== undefined ? (input.name ? input.name.trim() : `Čvor #${id}`) : existing.name,
      category_id: input.category_id !== undefined ? input.category_id : existing.category_id,
      status_id: input.status_id !== undefined ? input.status_id : existing.status_id,
      location_id: input.location_id !== undefined ? input.location_id : existing.location_id,
      building_id: input.building_id !== undefined ? input.building_id : existing.building_id,
      room_id: input.room_id !== undefined ? input.room_id : existing.room_id,
      rack_dims: input.rack_dims !== undefined ? (input.rack_dims ? input.rack_dims.trim() : null) : existing.rack_dims,
      route_desc: input.route_desc !== undefined ? (input.route_desc ? input.route_desc.trim() : null) : existing.route_desc,
      lines_count: input.lines_count !== undefined ? (input.lines_count !== null ? Number(input.lines_count) : null) : existing.lines_count,
      custom_code: input.custom_code !== undefined ? input.custom_code : existing.custom_code,
      comment: input.comment !== undefined ? (input.comment ? input.comment.trim() : null) : existing.comment,
      description: input.description !== undefined ? (input.description ? input.description.trim() : null) : existing.description,
      employee_no: input.employee_no !== undefined ? (input.employee_no ? input.employee_no.trim() : null) : existing.employee_no,
      inventory_no: input.inventory_no !== undefined ? (input.inventory_no ? input.inventory_no.trim() : null) : existing.inventory_no,
      date_arrived: input.date_arrived !== undefined ? (input.date_arrived ? input.date_arrived.trim() : null) : existing.date_arrived,
      date_purchased: input.date_purchased !== undefined ? (input.date_purchased ? input.date_purchased.trim() : null) : existing.date_purchased
    });

    return this.getNodeById(id);
  }

  /**
   * Adds a history/service note for a node
   */
  addHistory(data: { equipment_id: number; note: string; date?: string | null; phone?: string | null }): {
    id: number;
    equipment_id: number;
    date: string | null;
    note: string;
    phone: string | null;
  } {
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
    return db.prepare('SELECT id, equipment_id, date, note, phone FROM equipment_history WHERE id = ?').get(newId) as any;
  }

  /**
   * Deletes a history/service note
   */
  deleteHistory(historyId: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_history WHERE id = ?').run(historyId);
    return res.changes > 0;
  }

  /**
   * Deletes a Čvorište / Rack item
   */
  deleteNode(id: number): boolean {
    const db = getDb();
    db.prepare('DELETE FROM equipment_history WHERE equipment_id = ?').run(id);
    const res = db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
    return res.changes > 0;
  }
}

export const networkNodesDb = new NetworkNodesDb();

