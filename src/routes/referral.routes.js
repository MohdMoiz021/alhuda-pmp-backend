const express = require('express');
const router = express.Router();
const db = require('../../db');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    // TODO: Implement proper JWT verification
    // const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // req.user = decoded;
    
    // Temporary placeholder - replace with actual auth
    req.user = {  role: 'admin_b' };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// ======================================
// REFERRAL CODE APIs
// ======================================

/**
 * Generate referral code for internal team member
 * POST /api/referral/generate
 */
/**
 * Generate referral code for internal team member
 * POST /api/referral/generate
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    // Get userId from request body (sent from frontend)
    const { userId } = req.body;
    
    console.log(`Generating referral code for user: ${userId}`);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // First, get user details from database
    const userQuery = await db.query(
      `SELECT id, first_name, last_name, email, role 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userQuery.rows[0];
    const userRole = user.role;
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    
    // Get the first 3 letters of first name and last name
    const firstNameCode = firstName.substring(0, 3).toUpperCase();
    const lastNameCode = lastName.substring(0, 3).toUpperCase();
    
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Generate a random number (3-4 digits)
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    
    // Create referral code format: FNAME+LNAME+YEAR+RANDOM
    // Example: MOHMOI2025-4521 or AHMMED2026-7832
    let referralCode = `${firstNameCode}${lastNameCode}${currentYear}${randomNum}`;
    
    // Alternative format with separator: FNAMELNAME-YEAR-RANDOM
    // referralCode = `${firstNameCode}${lastNameCode}-${currentYear}-${randomNum}`;
    
    // Check if code is unique, if not, regenerate with different random number
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!isUnique && attempts < maxAttempts) {
      const check = await db.query(
        'SELECT id FROM referral_codes WHERE code = $1',
        [referralCode]
      );
      
      if (check.rows.length === 0) {
        isUnique = true;
      } else {
        // Regenerate random number
        const newRandomNum = Math.floor(Math.random() * 9000) + 1000;
        referralCode = `${firstNameCode}${lastNameCode}${currentYear}${newRandomNum}`;
        attempts++;
      }
    }

    // Check if user already has an active referral code
    const existingCode = await db.query(
      `SELECT id, code, created_at, expires_at, usage_count, usage_limit 
       FROM referral_codes 
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    if (existingCode.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active referral code',
        referralCode: existingCode.rows[0].code,
        expiresAt: existingCode.rows[0].expires_at,
        usageCount: existingCode.rows[0].usage_count,
        usageLimit: existingCode.rows[0].usage_limit
      });
    }

    // Insert new referral code
    const result = await db.query(
      `INSERT INTO referral_codes (user_id, code, created_by, usage_limit, created_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '90 days')
       RETURNING id, code, created_at, expires_at`,
      [userId, referralCode, userId, 100]
    );

    console.log(`✅ Referral code generated for user ${userId} (${firstName} ${lastName}): ${referralCode}`);

    res.json({
      success: true,
      message: 'Referral code generated successfully',
      referralCode: result.rows[0].code,
      expiresAt: result.rows[0].expires_at,
      createdAt: result.rows[0].created_at
    });

  } catch (error) {
    console.error('Error generating referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate referral code',
      error: error.message
    });
  }
});
/**
 * Get team member's referral stats
 * GET /api/referral/my-stats
 */
router.get('/my-stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `SELECT 
        rc.code,
        rc.created_at,
        rc.expires_at,
        rc.usage_count,
        rc.usage_limit,
        rc.is_active,
        COUNT(r.id) as total_referrals,
        COUNT(CASE WHEN r.status = 'completed' THEN 1 END) as completed_referrals,
        COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_referrals,
        COALESCE(SUM(rcp.amount), 0) as total_commission
      FROM referral_codes rc
      LEFT JOIN referrals r ON r.referral_code_id = rc.id
      LEFT JOIN referral_commissions rcp ON rcp.referral_id = r.id
      WHERE rc.user_id = $1 AND rc.is_active = true
      GROUP BY rc.id`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasCode: false,
        message: 'No active referral code found'
      });
    }

    // Get detailed referrals list
    const referralsResult = await db.query(
      `SELECT 
        r.id,
        CONCAT(u.first_name, ' ', u.last_name) as partner_name,
        u.email as partner_email,
        r.status,
        r.signed_up_at,
        r.commission_amount
      FROM referrals r
      JOIN users u ON u.id = r.referred_user_id
      WHERE r.referrer_user_id = $1
      ORDER BY r.signed_up_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      hasCode: true,
      referralCode: result.rows[0].code,
      createdAt: result.rows[0].created_at,
      expiresAt: result.rows[0].expires_at,
      usageCount: result.rows[0].usage_count || 0,
      usageLimit: result.rows[0].usage_limit || 100,
      isActive: result.rows[0].is_active,
      totalReferrals: parseInt(result.rows[0].total_referrals) || 0,
      completedReferrals: parseInt(result.rows[0].completed_referrals) || 0,
      pendingReferrals: parseInt(result.rows[0].pending_referrals) || 0,
      totalCommission: parseFloat(result.rows[0].total_commission) || 0,
      referrals: referralsResult.rows || []
    });

  } catch (error) {
    console.error('Error fetching referral stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral statistics',
      error: error.message
    });
  }
});


/**
 * GET /api/referral/get-code/:userId
 * Get referral code for a specific user by their ID
 */
router.get('/get-code/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`Fetching referral code for user: ${userId}`);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Query to get active referral code for the user
    const query = `
      SELECT 
        rc.id,
        rc.code,
        rc.created_at,
        rc.expires_at,
        rc.usage_count,
        rc.usage_limit,
        rc.is_active,
        u.first_name,
        u.last_name,
        u.email
      FROM referral_codes rc
      JOIN users u ON rc.user_id = u.id
      WHERE rc.user_id = $1 AND rc.is_active = true
      ORDER BY rc.created_at DESC
      LIMIT 1
    `;

    const result = await db.query(query, [userId]);

    // If no code found
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasCode: false,
        message: 'No referral code found for this user',
        referralCode: null
      });
    }

    const codeData = result.rows[0];

    // Get referrals count for this code
    const referralsQuery = `
      SELECT 
        COUNT(*) as total_referrals,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_referrals,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_referrals,
        COALESCE(SUM(commission_amount), 0) as total_commission
      FROM referrals
      WHERE referrer_user_id = $1
    `;

    const referralsResult = await db.query(referralsQuery, [userId]);

    res.json({
      success: true,
      hasCode: true,
      referralCode: codeData.code,
      createdAt: codeData.created_at,
      expiresAt: codeData.expires_at,
      usageCount: codeData.usage_count || 0,
      usageLimit: codeData.usage_limit || 100,
      isActive: codeData.is_active,
      userName: `${codeData.first_name} ${codeData.last_name}`,
      userEmail: codeData.email,
      totalReferrals: parseInt(referralsResult.rows[0]?.total_referrals) || 0,
      completedReferrals: parseInt(referralsResult.rows[0]?.completed_referrals) || 0,
      pendingReferrals: parseInt(referralsResult.rows[0]?.pending_referrals) || 0,
      totalCommission: parseFloat(referralsResult.rows[0]?.total_commission) || 0
    });

  } catch (error) {
    console.error('Error fetching referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral code',
      error: error.message
    });
  }
});

/**
 * Deactivate referral code
 * DELETE /api/referral/deactivate
 */
router.delete('/deactivate', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `UPDATE referral_codes 
       SET is_active = false 
       WHERE user_id = $1 AND is_active = true
       RETURNING code`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active referral code found'
      });
    }

    res.json({
      success: true,
      message: `Referral code ${result.rows[0].code} has been deactivated`
    });

  } catch (error) {
    console.error('Error deactivating referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate referral code',
      error: error.message
    });
  }
});

/**
 * Validate referral code (public endpoint)
 * GET /api/referral/validate/:code
 */
router.get('/validate/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const result = await db.query(
      `SELECT 
        rc.id as referral_code_id,
        rc.code,
        rc.user_id as referrer_id,
        u.first_name,
        u.last_name,
        u.email,
        rc.is_active,
        rc.expires_at,
        rc.usage_limit,
        COUNT(r.id) as current_usage
      FROM referral_codes rc
      JOIN users u ON rc.user_id = u.id
      LEFT JOIN referrals r ON r.referral_code_id = rc.id
      WHERE rc.code = $1
      GROUP BY rc.id, u.id`,
      [code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invalid referral code'
      });
    }

    const referral = result.rows[0];

    if (!referral.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Referral code is inactive'
      });
    }

    if (new Date(referral.expires_at) < new Date()) {
      return res.status(404).json({
        success: false,
        message: 'Referral code has expired'
      });
    }

    if (referral.current_usage >= referral.usage_limit) {
      return res.status(404).json({
        success: false,
        message: 'Referral code has reached its usage limit'
      });
    }

    res.json({
      success: true,
      message: 'Referral code is valid',
      referrer: {
        id: referral.referrer_id,
        name: `${referral.first_name} ${referral.last_name}`,
        email: referral.email
      }
    });

  } catch (error) {
    console.error('Error validating referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate referral code',
      error: error.message
    });
  }
});

// ======================================
// ADMIN APIs
// ======================================

/**
 * Get all referrals for admin
 * GET /api/referral/admin/all
 */
router.get('/admin/all', authenticate, async (req, res) => {
  try {
    const allowedRoles = ['admin', 'super_admin', 'admin_b', 'admin_c'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const { status, search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        r.id,
        rc.code as referral_code,
        CONCAT(referrer.first_name, ' ', referrer.last_name) as referrer_name,
        referrer.email as referrer_email,
        referrer.role as referrer_role,
        CONCAT(partner.first_name, ' ', partner.last_name) as partner_name,
        partner.email as partner_email,
        r.status,
        r.commission_amount,
        r.signed_up_at,
        r.first_case_completed_at,
        COALESCE(rcp.amount, 0) as paid_commission,
        rcp.payment_status
      FROM referrals r
      JOIN referral_codes rc ON r.referral_code_id = rc.id
      JOIN users referrer ON rc.user_id = referrer.id
      JOIN users partner ON r.referred_user_id = partner.id
      LEFT JOIN referral_commissions rcp ON rcp.referral_id = r.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      query += ` AND r.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        rc.code ILIKE $${paramIndex} OR 
        referrer.email ILIKE $${paramIndex} OR 
        partner.email ILIKE $${paramIndex} OR
        CONCAT(referrer.first_name, ' ', referrer.last_name) ILIKE $${paramIndex} OR
        CONCAT(partner.first_name, ' ', partner.last_name) ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY r.signed_up_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, queryParams);

    // Get summary
    const summaryResult = await db.query(
      `SELECT 
        COUNT(*) as total_referrals,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_referrals,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_referrals,
        COALESCE(SUM(commission_amount), 0) as total_commission,
        COUNT(DISTINCT rc.user_id) as active_referrers
      FROM referrals r
      JOIN referral_codes rc ON r.referral_code_id = rc.id`
    );

    res.json({
      success: true,
      referrals: result.rows,
      summary: summaryResult.rows[0],
      pagination: {
        total: parseInt(summaryResult.rows[0].total_referrals),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Error fetching admin referrals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referrals',
      error: error.message
    });
  }
});

module.exports = router;