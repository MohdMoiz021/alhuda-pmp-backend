// src/repositories/userRepository.js
const BaseRepository = require('./baseRepository');
const { User}=require('../models/User')

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByEmail(email) {
    return await User.findByEmail(email);
  }

  async getAllUsers(limit, offset) {
    return await User.getAll(limit, offset);
  }

  async getUsersByRole(role, limit = 50, offset = 0) {
    // Since we don't have a method for this in User model yet,
    // we can filter from getAll results or add a new method
    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, 
             role, is_active, created_at 
      FROM users 
      WHERE role = $1
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const { rows } = await require('../config/database').query(query, [role, limit, offset]);
    return rows;
  }

  async updateLastLogin(userId) {
    return await User.update(userId, { last_login: new Date() });
  }

  async countByRole(role) {
    const query = 'SELECT COUNT(*) FROM users WHERE role = $1';
    const { rows } = await require('../config/database').query(query, [role]);
    return parseInt(rows[0].count);
  }
}

module.exports = new UserRepository();