const express = require('express');
const { getAllUsers } = require('../controllers/user.Controller');
const { authenticate } = require('../../middleware/auth');
const db = require('../../db');
const userRoutes = express();

// All user routes require authentication
userRoutes.use(authenticate);

// User management routes
userRoutes.get('/', getAllUsers);

userRoutes.get('/:userId/phone', async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, role, is_active
      FROM users
      WHERE id = $1
    `;
    const result = await db.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    // Check if user has phone number
    if (!user.phone) {
      return res.status(404).json({
        success: false,
        message: 'User has no phone number on record',
        user: {
          id: user.id,
          email: user.email,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
        }
      });
    }

    // Format name
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    
    // Format phone for WhatsApp
    const formattedPhone = formatPhoneForWhatsApp(user.phone);

    res.json({
      success: true,
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      name: fullName,
      companyName: user.company_name,
      phoneNumber: user.phone,
      formattedPhone: formattedPhone,
      whatsappFormat: `whatsapp:${formattedPhone}`,
      role: user.role,
      isActive: user.is_active
    });

  } catch (error) {
    console.error('Error fetching user phone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user phone',
      error: error.message
    });
  }
});

/**
 * Update user phone number
 * PUT /api/users/:userId/phone
 */
userRoutes.put('/:userId/phone', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Basic validation
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be between 10-15 digits'
      });
    }

    const query = `
      UPDATE users
      SET phone = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, phone, first_name, email
    `;
    const result = await db.query(query, [phone, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Phone number updated successfully',
      user: result.rows[0],
      formattedPhone: formatPhoneForWhatsApp(phone)
    });

  } catch (error) {
    console.error('Error updating user phone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update phone number',
      error: error.message
    });
  }
});

/**
 * Batch get user phones
 * POST /api/users/phones/batch
 */
userRoutes.post('/phones/batch', async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userIds array is required'
      });
    }

    // Create parameterized placeholders ($1, $2, $3, etc.)
    const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',');
    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, role
      FROM users
      WHERE id IN (${placeholders})
    `;
    
    const result = await db.query(query, userIds);

    const users = result.rows.map(user => ({
      id: user.id,
      email: user.email,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
      phoneNumber: user.phone,
      companyName: user.company_name,
      role: user.role,
      hasPhone: !!user.phone,
      formattedPhone: user.phone ? formatPhoneForWhatsApp(user.phone) : null,
      whatsappFormat: user.phone ? `whatsapp:${formatPhoneForWhatsApp(user.phone)}` : null
    }));

    res.json({
      success: true,
      count: users.length,
      users: users
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * Get user details by ID
 * GET /api/users/:userId
 */
userRoutes.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const query = `
      SELECT id, email, first_name, last_name, phone, company_name, role, is_active, created_at
      FROM users
      WHERE id = $1
    `;
    const result = await db.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
        phone: user.phone,
        companyName: user.company_name,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

// ======================================
// Helper Functions
// ======================================

function formatPhoneForWhatsApp(phone) {
  if (!phone) return null;
  
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle different formats
  if (cleaned.length === 10) {
    // US/Canada: add 1
    cleaned = '1' + cleaned;
  } else if (cleaned.startsWith('0')) {
    // Remove leading zero
    cleaned = cleaned.substring(1);
  }
  
  // Add + prefix
  return '+' + cleaned;
}


module.exports = userRoutes;