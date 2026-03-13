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
const { register, login, getProfile, updateProfile, getAllUsers, getUserById, getPendingSubConsultants, updateUserStatus, deleteUser } = require('../controllers/auth.controller');
const { authenticate } = require('../../middleware/auth');
const db = require('../../db');
const { emailTemplates } = require('../../services/emailService');
// In Express 5, router is not a separate function
const authRoutes = express();

// Public routes
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
authRoutes.get('/users/:id', authenticate, getUserById);
authRoutes.patch('/users/:id/status', authenticate, updateUserStatus);
authRoutes.delete('/users/:id', authenticate, deleteUser);
// PUT /api/users/:id/approve
authRoutes.put('/users/:id/approve', async (req, res) => {
  try {
    const userId = req.params.id;           // Sub consultant ID
    const { action } = req.body;            // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: "Action must be 'approve' or 'reject'" 
      });
    }

    // Determine is_active value
    const isActive = action === 'approve';

    // First, get the user details before updating
    const getUserQuery = `
      SELECT id, first_name, last_name, email, role, phone, company_name
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

    // Update user status
    const updateQuery = `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, first_name, last_name, email, is_active, role, phone, company_name
    `;
    const values = [isActive, userId];

    const updateResult = await db.query(updateQuery, values);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const updatedUser = updateResult.rows[0];

    // 📧 SEND EMAILS ONLY FOR APPROVAL ACTION
    if (action === 'approve') {
      try {
        // 1. Send email to the approved user (Sub Consultant)
        await emailTemplates.approvalStatus(
          updatedUser,
          'approved'
        );
        console.log(`✅ Approval email sent to sub consultant: ${updatedUser.email}`);

        // 2. Get all admin users (admin_a and admin_c) to notify them
        const adminQuery = `
          SELECT id, first_name, last_name, email, role
          FROM users
          WHERE role IN ('admin_a', 'admin_c') 
          AND is_active = true
          AND id != $1  -- Exclude the current user if they are admin (unlikely)
        `;
        const adminResult = await db.query(adminQuery, [userId]);
        const adminUsers = adminResult.rows;

        console.log(`📋 Found ${adminUsers.length} admins to notify`);

        // 3. Send notification to each admin
        if (adminUsers.length > 0) {
          const adminNotificationPromises = adminUsers.map(admin => 
            emailTemplates.adminNotificationForApproval(updatedUser, admin)
              .catch(err => {
                console.error(`❌ Failed to send notification to admin ${admin.email}:`, err.message);
                return null; // Continue with other admins even if one fails
              })
          );

          await Promise.all(adminNotificationPromises);
          console.log(`✅ Admin notifications sent to ${adminUsers.length} admins`);
        } else {
          console.log('⚠️ No active admin users found to notify');
        }

      } catch (emailError) {
        // Log email error but don't fail the request
        console.error('❌ Error sending approval emails:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: `User has been ${action}d successfully`,
      user: updatedUser,
      emailsSent: action === 'approve' ? true : false
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

module.exports = authRoutes;