// const express = require('express');
// const router = express.Router();
// const { signup, login, getProfile } = require('../controllers/auth.controller');
// const authMiddleware = require('../../middleware/auth');

// // ✅ SWAGGER DOCUMENTATION
// /**
//  * @swagger
//  * /api/auth/signup:
//  *   post:
//  *     summary: Create new user
//  *     tags: [Auth]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               name:
//  *                 type: string
//  *                 example: "John Doe"
//  *               email:
//  *                 type: string
//  *                 example: "john@example.com"
//  *               password:
//  *                 type: string
//  *                 example: "password123"
//  *     responses:
//  *       201:
//  *         description: User created
//  */
// router.post('/signup', signup);

// /**
//  * @swagger
//  * /api/auth/login:
//  *   post:
//  *     summary: Login user
//  *     tags: [Auth]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               email:
//  *                 type: string
//  *                 example: "john@example.com"
//  *               password:
//  *                 type: string
//  *                 example: "password123"
//  *     responses:
//  *       200:
//  *         description: Login successful
//  */
// router.post('/login', login);

// /**
//  * @swagger
//  * /api/auth/profile:
//  *   get:
//  *     summary: Get user profile
//  *     tags: [Auth]
//  *     security:
//  *       - bearerAuth: []
//  *     responses:
//  *       200:
//  *         description: User profile
//  */
// router.get('/profile', authMiddleware, getProfile);

// module.exports = router;

// src/routes/authRoutes.js
const express = require('express');
const { register, login, getProfile, updateProfile, getAllUsers, getUserById, getPendingSubConsultants, updateUserStatus, deleteUser, getRejectedSubConsultants } = require('../controllers/auth.controller');
const { authenticate } = require('../../middleware/auth');
const db = require('../../db');
const { emailTemplates } = require('../../services/emailService');
const { resetPassword, forgotPassword, verifyResetToken } = require('../controllers/forgotPassword.controller');
const authRoutes = express();

authRoutes.post('/register', register);
authRoutes.post('/login', login);
authRoutes.get('/internalteam', async (req,res)=>{
    try{
        const query=`
       SELECT 
        id,
        email,
        first_name,
        last_name,
        phone,
        company_name,
        role,
        is_active,
        created_at,
        updated_at
      FROM users
      WHERE role = 'admin_b'
      ORDER BY created_at DESC;`
  const result=await db.query(query)

  res.status(200).json({
    success:true,
    count:result.rows.length,
    data:result.rows
  })
    }catch(error){
        console.error('ErrorFetching internal team', error)
        res.status(500).json({
            success:false,
            message:'Failed To fetch internal team users'
        })
    }

  



});
// Protected routes
authRoutes.get('/profile', authenticate, getProfile);
authRoutes.put('/profile', authenticate, updateProfile);
authRoutes.get('/users', authenticate, getAllUsers);
authRoutes.get('/users/pending', authenticate, getPendingSubConsultants);
authRoutes.get('/users/rejected', authenticate, getRejectedSubConsultants);
authRoutes.get('/users/:id', authenticate, getUserById);
authRoutes.patch('/users/:id/status', authenticate, updateUserStatus);
authRoutes.delete('/users/:id', authenticate, deleteUser);
// PUT /api/users/:id/approve
authRoutes.put('/users/:id/approve', async (req, res) => {
  try {
    const userId = req.params.id;           // Sub consultant ID
    const { action, rejection_reason } = req.body;  // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: "Action must be 'approve' or 'reject'" 
      });
    }

    // For reject action, rejection_reason is required
    if (action === 'reject' && !rejection_reason) {
      return res.status(400).json({ 
        success: false, 
        message: "Rejection reason is required for rejecting a user" 
      });
    }

    // First, get the user details before updating
    const getUserQuery = `
      SELECT id, first_name, last_name, email, role, phone, whatsapp_number, company_name, location, is_active
      FROM users 
      WHERE id = $1
    `;
    const userResult = await db.query(getUserQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const userData = userResult.rows[0];

    // Check if user is already processed
    if (userData.is_active !== null) {
      return res.status(400).json({ 
        success: false, 
        message: `User has already been ${userData.is_active ? 'approved' : 'rejected'}` 
      });
    }

    // Determine is_active value and update fields
    let isActive = null;
    let updateFields = '';
    let values = [];

    if (action === 'approve') {
      isActive = true;
      updateFields = 'is_active = $1, updated_at = NOW()';
      values = [isActive, userId];
    } else {
      isActive = false;
      updateFields = 'is_active = $1, rejection_reason = $2, updated_at = NOW()';
      values = [isActive, rejection_reason, userId];
    }

    // Update user status
    const updateQuery = `
      UPDATE users
      SET ${updateFields}
      WHERE id = $${values.length}
      RETURNING id, first_name, last_name, email, is_active, role, phone, whatsapp_number, company_name, location, rejection_reason, created_at, updated_at
    `;
    
    const updateResult = await db.query(updateQuery, values);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const updatedUser = updateResult.rows[0];

    // 📧 SEND EMAILS BASED ON ACTION
    try {
      if (action === 'approve') {
        // 1. Send approval email to the approved user (Sub Consultant)
        await emailTemplates.registrationApproved({
          name: `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim() || updatedUser.email,
          email: updatedUser.email,
          phone: updatedUser.phone,
          whatsapp_number: updatedUser.whatsapp_number,
          company_name: updatedUser.company_name,
          location: updatedUser.location,
          login_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        });
        console.log(`✅ Approval email sent to sub consultant: ${updatedUser.email}`);

        // 2. Send notification to both hardcoded admin emails
        const ADMIN_EMAILS = ['tech@alhudafinancial.com', 'info@alhudafinancial.com'];
        
        await emailTemplates.adminApprovalNotification({
          admin_name: 'Admin',
          admin_email: ADMIN_EMAILS[0],
          cc_email: ADMIN_EMAILS[1],
          approved_user: {
            name: `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim() || updatedUser.email,
            email: updatedUser.email,
            phone: updatedUser.phone || 'Not provided',
            whatsapp_number: updatedUser.whatsapp_number || 'Not provided',
            company_name: updatedUser.company_name || 'Not provided',
            location: updatedUser.location || 'Not provided',
            approved_date: new Date().toLocaleString()
          },
          admin_dashboard_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users`
        });
        
        console.log(`✅ Admin approval notification sent to: ${ADMIN_EMAILS.join(', ')}`);

      } else if (action === 'reject') {
        // Send rejection email to the user
        await emailTemplates.registrationRejected({
          name: `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim() || updatedUser.email,
          email: updatedUser.email,
          rejection_reason: rejection_reason,
          support_email: 'support@alhudafinancial.com'
        });
        console.log(`✅ Rejection email sent to: ${updatedUser.email}`);

        // Send notification to admins about rejection
        const ADMIN_EMAILS = ['tech@alhudafinancial.com', 'info@alhudafinancial.com'];
        
        await emailTemplates.adminRejectionNotification({
          admin_name: 'Admin',
          admin_email: ADMIN_EMAILS[0],
          cc_email: ADMIN_EMAILS[1],
          rejected_user: {
            name: `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim() || updatedUser.email,
            email: updatedUser.email,
            phone: updatedUser.phone || 'Not provided',
            whatsapp_number: updatedUser.whatsapp_number || 'Not provided',
            company_name: updatedUser.company_name || 'Not provided',
            location: updatedUser.location || 'Not provided',
            rejection_reason: rejection_reason,
            rejected_date: new Date().toLocaleString()
          }
        });
        
        console.log(`✅ Admin rejection notification sent to: ${ADMIN_EMAILS.join(', ')}`);
      }

    } catch (emailError) {
      // Log email error but don't fail the request
      console.error('❌ Error sending emails:', emailError);
    }

    res.status(200).json({
      success: true,
      message: `User has been ${action}d successfully`,
      user: updatedUser,
      emailsSent: true
    });

  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
});

authRoutes.post('/forgot-password', forgotPassword);
authRoutes.post('/reset-password', resetPassword);
authRoutes.get('/verify-reset-token/:token', verifyResetToken);
authRoutes.get('/test-email-config', (req, res) => {
  const config = {
    host: process.env.BREVO_SMTP_HOST,
    port: process.env.BREVO_SMTP_PORT,
    user: process.env.BREVO_SMTP_LOGIN,
    from_email: process.env.BREVO_FROM_EMAIL,
    from_name: process.env.BREVO_FROM_NAME,
    // Don't show the actual key
    key_configured: !!process.env.BREVO_SMTP_KEY
  };
  
  res.json({
    success: true,
    config: config
  });
});

// In your auth routes file
authRoutes.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const userResult = await pool.query(
      `SELECT id, email, first_name, last_name 
       FROM users 
       WHERE reset_password_token = $1 
         AND reset_password_expires > NOW() 
         AND is_active = true`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const user = userResult.rows[0];
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        email: user.email,
        name: userName
      }
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during token verification'
    });
  }
});

module.exports = authRoutes;