const pool = require("../../db");
const bcrypt = require("bcryptjs");

const User = {
  // Check if user exists
  findByEmail: async (email) => {
    const result = await pool.query(
      "SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1",
      [email]
    );
    return result.rows[0];
  },

  // Create new user
  create: async (userData) => {
    const { name, email, password } = userData;
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [name, email, passwordHash, true]
    );
    
    return result.rows[0];
  },

  // Find user by ID
  findById: async (id) => {
    const result = await pool.query(
      "SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = $1",
      [id]
    );
    return result.rows[0];
  },

  // Verify password
  verifyPassword: async (password, passwordHash) => {
    return await bcrypt.compare(password, passwordHash);
  },

  // Update last login
  updateLastLogin: async (id) => {
    await pool.query(
      "UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id]
    );
  }
};

module.exports = User;