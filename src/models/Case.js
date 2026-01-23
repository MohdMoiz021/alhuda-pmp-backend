// src/models/Case.js
const pool = require('../config/database');
const { CASE_STATUS, PRIORITY_LEVELS } = require('../config/constants');

class Case {
  static async create(caseData) {
    const { client_name, client_email, client_phone, service_type, 
            partner_id, deal_value, priority } = caseData;
    
    // Generate case number
    const year = new Date().getFullYear();
    const query = `
      INSERT INTO cases 
      (client_name, client_email, client_phone, service_type, 
       partner_id, deal_value, priority, case_number) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, 
             'ALH-${year}-' || LPAD(nextval('case_number_seq')::text, 5, '0')) 
      RETURNING id, case_number, client_name, client_email, client_phone, 
                service_type, status, priority, partner_id, deal_value, created_at
    `;
    
    const values = [client_name, client_email, client_phone, service_type, 
                   partner_id, deal_value, priority || PRIORITY_LEVELS.STANDARD];
    
    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT c.*, u.email as partner_email, u.company_name as partner_company
      FROM cases c
      LEFT JOIN users u ON c.partner_id = u.id
      WHERE c.id = $1
    `;
    
    try {
      const result = await pool.query(query, [id]);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async findByPartner(partnerId, status = null) {
    let query = `
      SELECT * FROM cases 
      WHERE partner_id = $1
    `;
    const values = [partnerId];
    
    if (status) {
      query += ' AND status = $2';
      values.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    try {
      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  static async updateStatus(id, status, assignedTo = null) {
    const updates = { status, updated_at: new Date() };
    if (assignedTo) updates.assigned_to = assignedTo;
    
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    values.push(id);

    const query = `
      UPDATE cases 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, case_number, status, assigned_to, updated_at
    `;

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async getAll(filters = {}) {
    let query = 'SELECT * FROM cases WHERE 1=1';
    const values = [];
    let paramCount = 1;

    if (filters.status) {
      query += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    if (filters.partner_id) {
      query += ` AND partner_id = $${paramCount}`;
      values.push(filters.partner_id);
      paramCount++;
    }

    if (filters.assigned_to) {
      query += ` AND assigned_to = $${paramCount}`;
      values.push(filters.assigned_to);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
    }

    try {
      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Case;