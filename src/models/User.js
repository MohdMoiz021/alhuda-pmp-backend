// src/models/User.js
const pool = require('../../db');
const { USER_ROLES } = require('../../config/constant');

class User {
  static async create(userData) {
    const { email, password_hash, first_name, last_name, phone, company_name, role } = userData;
    
    const query = `
      INSERT INTO users 
      (email, password_hash, first_name, last_name, phone, company_name, role) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, created_at
    `;
    
    const values = [email, password_hash, first_name, last_name, phone, company_name, role];
    
    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT id, email, password_hash, first_name, last_name, phone, company_name, 
             role, is_active, created_at 
      FROM users 
      WHERE email = $1
    `;
    
    try {
      const result = await pool.query(query, [email]);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, 
             role, is_active, created_at 
      FROM users 
      WHERE id = $1
    `;
    
    try {
      const result = await pool.query(query, [id]);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async update(id, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    // Always update the updated_at timestamp
    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date());
    
    values.push(id);

    const query = `
      UPDATE users 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, updated_at
    `;

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  static async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, 
             role, is_active, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    
    try {
      const result = await pool.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  static async count() {
    const query = 'SELECT COUNT(*) FROM users';
    
    try {
      const result = await pool.query(query);
      return parseInt(result.rows[0].count);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = User;