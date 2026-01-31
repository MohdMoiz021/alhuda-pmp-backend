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

    const query = `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, first_name, email, is_active
    `;
    const values = [isActive, userId];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.status(200).json({
      success: true,
      message: `User has been ${action}d successfully`,
      user: result.rows[0]
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