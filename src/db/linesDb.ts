import { getDb } from './sqlite.js';
import { initSchema } from './schema.js';

initSchema();

export interface LineItem {
  id: number;
  wall_socket_no: number | null;
  patch_panel_code: string | null;
  room_id: number | null;
  cvor_id: number | null;
  route_description: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;

  // Joined Room / Location
  room_name?: string | null;
  room_code?: string | null;
  room_floor?: string | null;
  building_id?: number | null;
  building_name?: string | null;
  location_id?: number | null;
  location_name?: string | null;

  // Joined Čvor / Rack
  cvor_name?: string | null;
  cvor_category_name?: string | null;
  cvor_rack_dims?: string | null;
  cvor_total_lines?: number | null;
  cvor_location_name?: string | null;
  cvor_building_name?: string | null;
  cvor_room_name?: string | null;

  // Related equipment & employees in room
  room_equipment_count?: number;
  room_equipment_list?: Array<{
    id: number;
    name: string;
    category_name: string;
    employee_no?: string | null;
    employee_name?: string | null;
    status_name?: string | null;
  }>;
}

export interface LineInput {
  wall_socket_no?: number | null;
  patch_panel_code?: string | null;
  room_id?: number | null;
  cvor_id?: number | null;
  route_description?: string | null;
  description?: string | null;
}

export interface LinesStats {
  total: number;
  uniqueCvorovi: number;
  coveredRooms: number;
  withPatchCode: number;
  withRouteDesc: number;
}

export class LinesDb {
  /**
   * Returns KPI summary metrics for Lines section
   */
  getStats(): LinesStats {
    const db = getDb();

    const totalRow = db.prepare('SELECT COUNT(*) as count FROM equipment_lines').get() as { count: number };
    const cvorRow = db.prepare('SELECT COUNT(DISTINCT cvor_id) as count FROM equipment_lines WHERE cvor_id IS NOT NULL AND cvor_id > 0').get() as { count: number };
    const roomRow = db.prepare('SELECT COUNT(DISTINCT room_id) as count FROM equipment_lines WHERE room_id IS NOT NULL AND room_id > 0').get() as { count: number };
    const patchRow = db.prepare("SELECT COUNT(*) as count FROM equipment_lines WHERE patch_panel_code IS NOT NULL AND trim(patch_panel_code) != ''").get() as { count: number };
    const routeRow = db.prepare("SELECT COUNT(*) as count FROM equipment_lines WHERE route_description IS NOT NULL AND trim(route_description) != ''").get() as { count: number };

    return {
      total: totalRow?.count || 0,
      uniqueCvorovi: cvorRow?.count || 0,
      coveredRooms: roomRow?.count || 0,
      withPatchCode: patchRow?.count || 0,
      withRouteDesc: routeRow?.count || 0
    };
  }

  /**
   * Lists lines with pagination, multi-criteria filtering, and joined rack/room details
   */
  getLines(options: {
    page?: number;
    limit?: number;
    search?: string;
    cvorId?: number;
    roomId?: number;
    buildingId?: number;
    locationId?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }): { items: LineItem[]; total: number } {
    const db = getDb();
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(500, options.limit || 50));
    const offset = (page - 1) * limit;

    let whereClauses: string[] = [];
    let params: Record<string, any> = {};

    if (options.cvorId) {
      whereClauses.push('l.cvor_id = @cvorId');
      params.cvorId = options.cvorId;
    }

    if (options.roomId) {
      whereClauses.push('l.room_id = @roomId');
      params.roomId = options.roomId;
    }

    if (options.buildingId) {
      whereClauses.push('r.building = @buildingId');
      params.buildingId = options.buildingId;
    }

    if (options.locationId) {
      whereClauses.push('b.location_id = @locationId');
      params.locationId = options.locationId;
    }

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      params.q = q;
      whereClauses.push(`(
        CAST(l.id AS TEXT) LIKE @q
        OR CAST(l.wall_socket_no AS TEXT) LIKE @q
        OR l.patch_panel_code LIKE @q
        OR l.route_description LIKE @q
        OR l.description LIKE @q
        OR r.name LIKE @q
        OR r.code LIKE @q
        OR b.name LIKE @q
        OR loc.name LIKE @q
        OR cv.name LIKE @q
        OR cv.description LIKE @q
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const validSortCols: Record<string, string> = {
      id: 'l.id',
      wall_socket_no: 'l.wall_socket_no',
      patch_panel_code: 'l.patch_panel_code',
      room_name: 'r.name',
      cvor_name: 'cv.name',
      building_name: 'b.name',
      location_name: 'loc.name'
    };

    const sortBy = validSortCols[options.sortBy || 'id'] || 'l.id';
    const sortOrder = options.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    const countSql = `
      SELECT COUNT(*) as total
      FROM equipment_lines l
      LEFT JOIN equipment_rooms r ON l.room_id = r.id
      LEFT JOIN equipment_buildings b ON r.building = b.id
      LEFT JOIN equipment_locations loc ON b.location_id = loc.id
      LEFT JOIN equipment cv ON l.cvor_id = cv.id
      ${whereSql}
    `;

    const totalRow = db.prepare(countSql).get(params) as { total: number };
    const total = totalRow?.total || 0;

    const dataSql = `
      SELECT 
        l.id,
        l.wall_socket_no,
        l.patch_panel_code,
        l.room_id,
        l.cvor_id,
        l.route_description,
        l.description,
        l.created_at,
        l.updated_at,
        r.name as room_name,
        r.code as room_code,
        r.floor as room_floor,
        b.id as building_id,
        b.name as building_name,
        loc.id as location_id,
        loc.name as location_name,
        CASE WHEN cv.id IS NOT NULL THEN COALESCE(NULLIF(trim(cv.name), ''), NULLIF(trim(cv.description), ''), 'Čvor #' || cv.id) ELSE NULL END as cvor_name,
        cv_cat.name as cvor_category_name,
        cv.rack_dims as cvor_rack_dims,
        cv.lines_count as cvor_total_lines,
        cv_loc.name as cvor_location_name,
        cv_bld.name as cvor_building_name,
        cv_rm.name as cvor_room_name
      FROM equipment_lines l
      LEFT JOIN equipment_rooms r ON l.room_id = r.id
      LEFT JOIN equipment_buildings b ON r.building = b.id
      LEFT JOIN equipment_locations loc ON b.location_id = loc.id
      LEFT JOIN equipment cv ON l.cvor_id = cv.id
      LEFT JOIN equipment_categories cv_cat ON cv.category_id = cv_cat.id
      LEFT JOIN equipment_locations cv_loc ON cv.location_id = cv_loc.id
      LEFT JOIN equipment_buildings cv_bld ON cv.building_id = cv_bld.id
      LEFT JOIN equipment_rooms cv_rm ON cv.room_id = cv_rm.id
      ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT @limit OFFSET @offset
    `;

    const rows = db.prepare(dataSql).all({ ...params, limit, offset }) as any[];

    // Fetch equipment count in each room for rich badges
    const roomIds = Array.from(new Set(rows.map(r => r.room_id).filter(Boolean)));
    const roomEqCountMap = new Map<number, number>();

    if (roomIds.length > 0) {
      const placeholders = roomIds.map(() => '?').join(',');
      const eqCounts = db.prepare(`
        SELECT room_id, COUNT(*) as count 
        FROM equipment 
        WHERE room_id IN (${placeholders}) AND status_id != 5
        GROUP BY room_id
      `).all(roomIds) as Array<{ room_id: number; count: number }>;

      for (const ec of eqCounts) {
        roomEqCountMap.set(ec.room_id, ec.count);
      }
    }

    const items: LineItem[] = rows.map(r => ({
      ...r,
      patch_panel_code: r.patch_panel_code ? r.patch_panel_code.trim() : null,
      room_equipment_count: r.room_id ? (roomEqCountMap.get(r.room_id) || 0) : 0
    }));

    return { items, total };
  }

  /**
   * Retrieves single line with full relational hierarchy and list of devices in room
   */
  getLineById(id: number): LineItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        l.id,
        l.wall_socket_no,
        l.patch_panel_code,
        l.room_id,
        l.cvor_id,
        l.route_description,
        l.description,
        l.created_at,
        l.updated_at,
        r.name as room_name,
        r.code as room_code,
        r.floor as room_floor,
        b.id as building_id,
        b.name as building_name,
        loc.id as location_id,
        loc.name as location_name,
        CASE WHEN cv.id IS NOT NULL THEN COALESCE(NULLIF(trim(cv.name), ''), NULLIF(trim(cv.description), ''), 'Čvor #' || cv.id) ELSE NULL END as cvor_name,
        cv_cat.name as cvor_category_name,
        cv.rack_dims as cvor_rack_dims,
        cv.lines_count as cvor_total_lines,
        cv_loc.name as cvor_location_name,
        cv_bld.name as cvor_building_name,
        cv_rm.name as cvor_room_name
      FROM equipment_lines l
      LEFT JOIN equipment_rooms r ON l.room_id = r.id
      LEFT JOIN equipment_buildings b ON r.building = b.id
      LEFT JOIN equipment_locations loc ON b.location_id = loc.id
      LEFT JOIN equipment cv ON l.cvor_id = cv.id
      LEFT JOIN equipment_categories cv_cat ON cv.category_id = cv_cat.id
      LEFT JOIN equipment_locations cv_loc ON cv.location_id = cv_loc.id
      LEFT JOIN equipment_buildings cv_bld ON cv.building_id = cv_bld.id
      LEFT JOIN equipment_rooms cv_rm ON cv.room_id = cv_rm.id
      WHERE l.id = ?
    `).get(id) as any;

    if (!row) return null;

    row.patch_panel_code = row.patch_panel_code ? row.patch_panel_code.trim() : null;

    // Get equipment located in the same room
    if (row.room_id) {
      const eqRows = db.prepare(`
        SELECT 
          e.id, 
          e.name, 
          cat.name as category_name,
          e.employee_no,
          st.name as status_name
        FROM equipment e
        LEFT JOIN equipment_categories cat ON e.category_id = cat.id
        LEFT JOIN equipment_statuses st ON e.status_id = st.id
        WHERE e.room_id = ? AND e.status_id != 5
        ORDER BY e.category_id ASC, e.name ASC
      `).all(row.room_id) as any[];

      row.room_equipment_list = eqRows;
      row.room_equipment_count = eqRows.length;
    } else {
      row.room_equipment_list = [];
      row.room_equipment_count = 0;
    }

    return row as LineItem;
  }

  /**
   * Creates a new line record
   */
  createLine(input: LineInput & { id?: number }): LineItem {
    const db = getDb();

    if (input.id) {
      db.prepare(`
        INSERT INTO equipment_lines (
          id, wall_socket_no, patch_panel_code, room_id, cvor_id, route_description, description, created_at, updated_at
        ) VALUES (
          @id, @wall_socket_no, @patch_panel_code, @room_id, @cvor_id, @route_description, @description, datetime('now'), datetime('now')
        )
      `).run({
        id: input.id,
        wall_socket_no: input.wall_socket_no || null,
        patch_panel_code: input.patch_panel_code ? input.patch_panel_code.trim() : null,
        room_id: input.room_id || null,
        cvor_id: input.cvor_id || null,
        route_description: input.route_description ? input.route_description.trim() : null,
        description: input.description ? input.description.trim() : null
      });

      return this.getLineById(input.id)!;
    }

    // Auto calculate next available ID
    const maxRow = db.prepare('SELECT MAX(id) as maxId FROM equipment_lines').get() as { maxId: number | null };
    const nextId = (maxRow?.maxId || 0) + 1;

    db.prepare(`
      INSERT INTO equipment_lines (
        id, wall_socket_no, patch_panel_code, room_id, cvor_id, route_description, description, created_at, updated_at
      ) VALUES (
        @id, @wall_socket_no, @patch_panel_code, @room_id, @cvor_id, @route_description, @description, datetime('now'), datetime('now')
      )
    `).run({
      id: nextId,
      wall_socket_no: input.wall_socket_no || null,
      patch_panel_code: input.patch_panel_code ? input.patch_panel_code.trim() : null,
      room_id: input.room_id || null,
      cvor_id: input.cvor_id || null,
      route_description: input.route_description ? input.route_description.trim() : null,
      description: input.description ? input.description.trim() : null
    });

    return this.getLineById(nextId)!;
  }

  /**
   * Updates an existing line record
   */
  updateLine(id: number, input: LineInput): LineItem | null {
    const db = getDb();
    const existing = this.getLineById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE equipment_lines
      SET 
        wall_socket_no = @wall_socket_no,
        patch_panel_code = @patch_panel_code,
        room_id = @room_id,
        cvor_id = @cvor_id,
        route_description = @route_description,
        description = @description,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      wall_socket_no: input.wall_socket_no !== undefined ? input.wall_socket_no : existing.wall_socket_no,
      patch_panel_code: input.patch_panel_code !== undefined ? (input.patch_panel_code ? input.patch_panel_code.trim() : null) : existing.patch_panel_code,
      room_id: input.room_id !== undefined ? input.room_id : existing.room_id,
      cvor_id: input.cvor_id !== undefined ? input.cvor_id : existing.cvor_id,
      route_description: input.route_description !== undefined ? (input.route_description ? input.route_description.trim() : null) : existing.route_description,
      description: input.description !== undefined ? (input.description ? input.description.trim() : null) : existing.description
    });

    return this.getLineById(id);
  }

  /**
   * Deletes a line record
   */
  deleteLine(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM equipment_lines WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Syncs legacy lines from SQL Server 121.20
   */
  syncLegacyLines(lines: Array<{
    id: number;
    oznaka_zid: number | null;
    oznaka_panel: string | null;
    kancelarija: number | null;
    cvor: number | null;
    opis_trase: string | null;
    opis: string | null;
  }>): void {
    const db = getDb();
    const insertOrReplace = db.prepare(`
      INSERT OR REPLACE INTO equipment_lines (
        id, wall_socket_no, patch_panel_code, room_id, cvor_id, route_description, description, updated_at
      ) VALUES (
        @id, @wall_socket_no, @patch_panel_code, @room_id, @cvor_id, @route_description, @description, datetime('now')
      )
    `);

    const syncTx = db.transaction((rows: typeof lines) => {
      // Clear out obsolete IDs if needed, or replace all
      for (const r of rows) {
        insertOrReplace.run({
          id: r.id,
          wall_socket_no: r.oznaka_zid || null,
          patch_panel_code: r.oznaka_panel ? r.oznaka_panel.trim() : null,
          room_id: r.kancelarija || null,
          cvor_id: r.cvor || null,
          route_description: r.opis_trase ? r.opis_trase.trim() : null,
          description: r.opis ? r.opis.trim() : null
        });
      }
    });

    syncTx(lines);
  }

  /**
   * Returns list of all čvorovi and rack cabinets for filter dropdowns
   */
  getAllCvorovi(): Array<{ id: number; name: string; location_name?: string; building_name?: string; total_lines?: number }> {
    const db = getDb();
    return db.prepare(`
      SELECT 
        e.id, 
        COALESCE(NULLIF(trim(e.name), ''), NULLIF(trim(e.description), ''), 'Čvor #' || e.id) as name, 
        loc.name as location_name,
        bld.name as building_name,
        e.lines_count as total_lines
      FROM equipment e
      LEFT JOIN equipment_locations loc ON e.location_id = loc.id
      LEFT JOIN equipment_buildings bld ON e.building_id = bld.id
      WHERE e.category_id IN (16, 33, 6) OR e.lines_count > 0 OR e.rack_dims IS NOT NULL
      ORDER BY e.location_id ASC, e.name ASC
    `).all() as any[];
  }

  /**
   * Returns list of all rooms / offices with building & location names
   */
  getAllRooms(): Array<{ id: number; name: string; code?: string; floor?: string; building_name?: string; location_name?: string }> {
    const db = getDb();
    return db.prepare(`
      SELECT 
        r.id, 
        r.name, 
        r.code, 
        r.floor,
        b.name as building_name,
        loc.name as location_name
      FROM equipment_rooms r
      LEFT JOIN equipment_buildings b ON r.building = b.id
      LEFT JOIN equipment_locations loc ON b.location_id = loc.id
      ORDER BY b.location_id ASC, b.name ASC, r.name ASC
    `).all() as any[];
  }
}

export const linesDb = new LinesDb();
