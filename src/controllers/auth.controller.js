// src/controllers/authController.js
const crypto = require('crypto');
const { pool } = require('../../db');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth');
const { sendEmail, emailTemplates } = require('../../services/emailService');
const { verifyTurnstile } = require('../utils/turnstile');

const SIGNUP_IP_DAILY_MAX = parseInt(process.env.SIGNUP_IP_DAILY_MAX || '5', 10);
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
// Hidden honeypot form field — real users never fill it.
const honeypotTripped = (body) => {
  const v = body && (body.company_website ?? body.website ?? body.url);
  return typeof v === 'string' && v.trim().length > 0;
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Reject obviously junk / disposable-looking email addresses.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'yopmail.com',
  'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com',
  'mohmal.com', 'emailondeck.com', 'mailnesia.com', 'spamgourmet.com', 'mintemail.com',
]);

const isPlausibleEmail = (email) => {
  if (typeof email !== 'string') return false;
  const value = email.trim().toLowerCase();
  // Standard shape + a real TLD of 2+ chars.
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value)) return false;
  const [local, domain] = value.split('@');
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return false;
  // Bot-style local parts, e.g. "397937549@..."
  if (/^\d{6,}$/.test(local)) return false;
  // Nonsense domains: no vowels at all in the SLD is a strong junk signal.
  const sld = domain.split('.').slice(-2, -1)[0] || '';
  if (sld.length >= 5 && !/[aeiou]/i.test(sld)) return false;
  return true;
};

const makeVerificationToken = () => crypto.randomBytes(32).toString('hex');

const sendVerificationEmail = async (user, token) => {
  const verify_url = `${FRONTEND_URL}/verify-email?token=${token}`;
  await emailTemplates.verifyEmail({
    name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
    email: user.email,
    verify_url,
  });
};
// const register = async (req, res) => {
//   try {
//     const { email, password, first_name, last_name, phone, company_name, role } = req.body;
//     if (!email || !password || !role) {
//       return res.status(400).json({
//         success: false,
//         message: 'Email, password, and role are required'
//       });
//     }

//     const validRoles = ['admin_a', 'admin_b', 'admin_c'];
//     if (!validRoles.includes(role)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid role. Must be admin_a, admin_b, or admin_c'
//       });
//     }
//     const existingUser = await pool.query(
//       'SELECT id FROM users WHERE email = $1',
//       [email]
//     );

//     if (existingUser.rows.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'User already exists with this email'
//       });
//     }
//     const hashedPassword = await hashPassword(password);
//     const is_active = role === 'admin_a' ? false : true;
//     const newUser = await pool.query(
//       `INSERT INTO users 
//        (email, password_hash, first_name, last_name, phone, company_name, role, is_active) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
//        RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, created_at`,
//       [email, hashedPassword, first_name, last_name, phone, company_name, role, is_active]
//     );
//   const user = newUser.rows[0];
//     const token = generateToken(user);
//     // const token = generateToken(newUser.rows[0]);

//         if (role === 'admin_a') {
//       // Send pending approval email to user
//       await sendEmail(emailTemplates.registrationPending(user));
      
//       // Notify admins about new pending registration
//       await sendEmail(emailTemplates.adminNotification(user));
      
//       console.log(`📧 Pending approval emails sent for ${email}`);
//     } else {
//       // Send welcome email for auto-approved users
//       await sendEmail(emailTemplates.registrationSuccess(user));
//       console.log(`📧 Welcome email sent for ${email}`);
//     }


//     res.status(201).json({
//       success: true,
//       message: role === 'admin_a' 
//         ? 'Sub Consultant application submitted successfully. Awaiting admin approval.' 
//         : 'User registered successfully',
//       data: {
//         user,
//         token
//       }
//     });

//   } catch (error) {
//     console.error('Registration error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error during registration'
//     });
//   }
// };



// Login User
const login = async (req, res) => {
  try {
    const { email, password, turnstile_token } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Bot / brute-force check
    const turnstile = await verifyTurnstile(turnstile_token, clientIp(req));
    if (!turnstile.ok) {
      return res.status(400).json({
        success: false,
        status: 'captcha_failed',
        message: 'Could not verify that you are human. Please complete the check and try again.'
      });
    }

    // Find user by email
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Archived ("Done Working With") accounts cannot log in.
    if (user.archived_at) {
      return res.status(403).json({
        success: false,
        status: 'archived',
        message: 'This account has been archived. Please contact support if you believe this is an error.'
      });
    }

    // ==================== ACCOUNT STATUS CHECK ====================
    // is_active can be: null (pending), true (approved), false (rejected)

    // For Sub Consultants (admin_a) - Check account status
    if (user.role === 'admin_a') {
      // Email ownership must be confirmed before anything else.
      if (user.email_verified === false) {
        return res.status(403).json({
          success: false,
          status: 'email_unverified',
          message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
          data: { email: user.email }
        });
      }

      // Case 1: Account is pending approval (is_active === null)
      if (user.is_active === null) {
        return res.status(403).json({
          success: false,
          message: 'Your Partner account is pending admin approval. Please wait for approval before logging in.',
          status: 'pending',
          data: {
            email: user.email,
            role: user.role,
            registered_at: user.created_at
          }
        });
      }
      
      // Case 2: Account is rejected (is_active === false)
      if (user.is_active === false) {
        return res.status(403).json({
          success: false,
          message: 'Your Partner account has been rejected by the admin. Please contact support for more information.',
          status: 'rejected',
          data: {
            email: user.email,
            role: user.role,
            rejection_reason: user.rejection_reason || 'No specific reason provided'
          }
        });
      }
      
      // Case 3: Account is approved (is_active === true)
      if (user.is_active === true) {
        // Proceed with login for approved accounts
        // Continue to password verification
      }
    }
    
    // For internal team members (admin_b, admin_c)
    else if (user.role === 'admin_b' || user.role === 'admin_c') {
      // Internal team members should always be active (is_active === true)
      if (user.is_active !== true) {
        return res.status(403).json({
          success: false,
          message: 'Your account is not active. Please contact administrator.',
          status: 'inactive'
        });
      }
    }
    
    // For any other roles or fallback
    else {
      // Generic active check for other roles
      if (user.is_active !== true) {
        return res.status(403).json({
          success: false,
          message: 'Account is not active. Contact administrator.',
          status: 'inactive'
        });
      }
    }

    // ==================== PASSWORD VERIFICATION ====================
    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = generateToken(user);

    // Remove sensitive data from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          ...userWithoutPassword,
          // Ensure is_active is properly typed in response
          is_active: user.is_active === true // Convert to boolean for frontend
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// const register = async (req, res) => {
//   try {
//     const { email, password, first_name, last_name, phone, company_name, role } = req.body;
    
//     if (!email || !password || !role) {
//       return res.status(400).json({
//         success: false,
//         message: 'Email, password, and role are required'
//       });
//     }

//     const validRoles = ['admin_a', 'admin_b', 'admin_c'];
//     if (!validRoles.includes(role)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid role. Must be admin_a, admin_b, or admin_c'
//       });
//     }

//     const existingUser = await pool.query(
//       'SELECT id FROM users WHERE email = $1',
//       [email]
//     );

//     if (existingUser.rows.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'User already exists with this email'
//       });
//     }

//     const hashedPassword = await hashPassword(password);
//     const is_active = role === 'admin_a' ? false : true;
    
//     const newUser = await pool.query(
//       `INSERT INTO users 
//        (email, password_hash, first_name, last_name, phone, company_name, role, is_active) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
//        RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, created_at`,
//       [email, hashedPassword, first_name, last_name, phone, company_name, role, is_active]
//     );

//     const user = newUser.rows[0];
//     const token = generateToken(user);

//     // 🚀 SEND EMAILS - BOTH SHOULD WORK NOW
//     if (role === 'admin_a') {
//       try {
//         // 1. Send email to user (pending approval)
//         await emailTemplates.registrationPending(user);
//         console.log(`✅ User email sent to: ${user.email}`);
        
//         // 2. Send email to admin (notification)
//         if (process.env.ADMIN_EMAIL) {
//           await emailTemplates.adminNotification(user);
//           console.log(`✅ Admin notification sent to: ${process.env.ADMIN_EMAIL}`);
//         } else {
//           console.log('❌ ADMIN_EMAIL not set in .env file');
//         }
//       } catch (emailError) {
//         console.error('❌ Email sending error:', emailError.message);
//         // Don't fail registration if email fails
//       }
//     } else {
//       // Send welcome email for auto-approved users
//       try {
//         await emailTemplates.welcome(user.email, `${user.first_name} ${user.last_name}`);
//         console.log(`✅ Welcome email sent to: ${user.email}`);
//       } catch (emailError) {
//         console.error('❌ Welcome email error:', emailError.message);
//       }
//     }

//     res.status(201).json({
//       success: true,
//       message: role === 'admin_a' 
//         ? 'Sub Consultant application submitted successfully. Awaiting admin approval.' 
//         : 'User registered successfully',
//       data: {
//         user,
//         token
//       }
//     });

//   } catch (error) {
//     console.error('Registration error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error during registration'
//     });
//   }
// };





// Get User Profile (Protected)

const register = async (req, res) => {
  try {
    const { 
      email, 
      password, 
      first_name, 
      last_name, 
      phone, 
      whatsapp_number,
      company_name,
      location,
      referral_code,
      turnstile_token,
      role
    } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and role are required'
      });
    }

    const validRoles = ['admin_a', 'admin_b', 'admin_c'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be admin_a, admin_b, or admin_c'
      });
    }

    // Bot protection — public partner signup only (internal users are created by an
    // authenticated admin and don't go through the Turnstile widget).
    const isPublicSignup = role === 'admin_a';
    if (isPublicSignup) {
      if (honeypotTripped(req.body)) {
        // Silent-ish reject; don't tell the bot what tripped it.
        return res.status(400).json({ success: false, status: 'bot_check_failed', message: 'Registration could not be completed. Please try again.' });
      }

      const turnstile = await verifyTurnstile(turnstile_token, clientIp(req));
      if (!turnstile.ok) {
        return res.status(400).json({
          success: false,
          status: 'captcha_failed',
          message: 'Could not verify that you are human. Please complete the check and try again.'
        });
      }

      // Per-IP signup velocity cap
      const ip = clientIp(req);
      if (ip) {
        const recent = await pool.query(
          `SELECT COUNT(*)::int AS count FROM users
           WHERE signup_ip = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
          [ip]
        );
        if (recent.rows[0].count >= SIGNUP_IP_DAILY_MAX) {
          return res.status(429).json({
            success: false,
            status: 'too_many_signups',
            message: 'Too many registrations from your network today. Please try again tomorrow or contact support.'
          });
        }
      }
    }

    // Reject junk / disposable email addresses
    if (!isPlausibleEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please use a valid, permanent email address.'
      });
    }

    // Password strength
    if (typeof password !== 'string' || password.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and include letters and numbers.'
      });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    const hashedPassword = await hashPassword(password);
    
    // Set is_active based on role:
    // - admin_a (Partner): NULL (pending approval)
    // - admin_b/admin_c (Internal): true (auto-approved)
    let is_active = null;
    if (role === 'admin_a') {
      is_active = null; // Pending approval
    } else {
      is_active = true; // Auto-approved for internal team
    }
    
    // Partners must verify their email; internal team members are pre-verified.
    const needsEmailVerification = role === 'admin_a';
    const verificationToken = needsEmailVerification ? makeVerificationToken() : null;
    const verificationExpires = needsEmailVerification
      ? new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
      : null;

    // Insert user with new fields
const newUser = await pool.query(
  `INSERT INTO users
   (email, password_hash, first_name, last_name, phone, whatsapp_number, company_name, location, role, is_active, referral_code, email_verified, email_verification_token, email_verification_expires, signup_ip)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
   RETURNING id, email, first_name, last_name, phone, whatsapp_number, company_name, location, role, is_active, referral_code, email_verified, created_at`,
  [
    email,
    hashedPassword,
    first_name,
    last_name,
    phone,
    whatsapp_number || null,
    company_name,
    location || null,
    role,
    is_active,
    referral_code || null, // 👈 important
    !needsEmailVerification,
    verificationToken,
    verificationExpires,
    clientIp(req)
  ]
);

if (referral_code && referral_code.length > 50) {
  return res.status(400).json({
    success: false,
    message: 'Referral code too long'
  });
}
    const user = newUser.rows[0];
    const token = generateToken(user);

    // 🚀 SEND EMAILS BASED ON ROLE
    try {
      if (role === 'admin_a') {
        // Partner registration - needs approval

        // 0. Send email verification link
        if (verificationToken) {
          await sendVerificationEmail(user, verificationToken);
          console.log(`✅ Verification email sent to partner: ${user.email}`);
        }

        // 1. Send email to user (pending approval)
        await emailTemplates.registrationPending({
          ...user,
          whatsapp_number: user.whatsapp_number || 'Not provided',
          location: user.location || 'Not provided'
        });
        console.log(`✅ Pending approval email sent to partner: ${user.email}`);
        
        // 2. Send email to both admin emails
        const ADMIN_EMAILS = ['tech@alhudafinancial.com', 'info@alhudafinancial.com'];
        
        await emailTemplates.adminNotification({
          ...user,
          whatsapp_number: user.whatsapp_number || 'Not provided',
          location: user.location || 'Not provided'
        });
        
        console.log(`✅ Admin notification sent to: ${ADMIN_EMAILS.join(', ')}`);
        
      } else if (role === 'admin_b' || role === 'admin_c') {
        // Internal team member - auto-approved
        
        // 1. Send welcome email to the new team member
        await emailTemplates.welcomeTeamMember({
          email: user.email,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
          role: role === 'admin_b' ? 'Admin' : 'Manager',
          login_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        });
        console.log(`✅ Welcome email sent to new team member: ${user.email}`);
        
        // 2. Send notification to both admin emails
        const ADMIN_EMAILS = ['tech@alhudafinancial.com', 'info@alhudafinancial.com'];
        
        await emailTemplates.newTeamMemberNotification({
          admin_name: 'Admin',
          admin_email: ADMIN_EMAILS[0],
          cc_email: ADMIN_EMAILS[1],
          new_member_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
          new_member_email: user.email,
          new_member_role: role === 'admin_b' ? 'Admin' : 'Manager',
          new_member_phone: user.phone || 'Not provided',
          new_member_whatsapp: user.whatsapp_number || 'Not provided',
          new_member_company: user.company_name || 'Not provided',
          new_member_location: user.location || 'Not provided',
          registered_date: new Date().toLocaleString(),
          admin_dashboard_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/team`
        });
        
        console.log(`✅ New member notification sent to: ${ADMIN_EMAILS.join(', ')}`);
      }
    } catch (emailError) {
      console.error('❌ Email sending error:', emailError.message);
    }

    res.status(201).json({
      success: true,
      message: role === 'admin_a'
        ? 'Partner application submitted. Please check your inbox and verify your email address, then wait for admin approval.'
        : 'Internal team member registered successfully',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};


const getProfile = async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, email, first_name, last_name, phone, company_name, role, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userResult.rows[0]
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update User Profile (Protected)
const updateProfile = async (req, res) => {
  try {
    const { first_name, last_name, phone, company_name } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (first_name !== undefined) {
      updates.push(`first_name = $${paramCount}`);
      values.push(first_name);
      paramCount++;
    }

    if (last_name !== undefined) {
      updates.push(`last_name = $${paramCount}`);
      values.push(last_name);
      paramCount++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }

    if (company_name !== undefined) {
      updates.push(`company_name = $${paramCount}`);
      values.push(company_name);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided'
      });
    }

    // Add user id to values
    values.push(req.user.id);

    const updateQuery = `
      UPDATE users 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, updated_at
    `;

    const result = await pool.query(updateQuery, values);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get all users (Only for admin_c)
const getAllUsers = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view all users.'
      });
    }

    // Archived users are hidden unless explicitly requested.
    const includeArchived = String(req.query.include_archived || '').toLowerCase() === 'true';

    // Fetch all users with all fields except password_hash
    const usersResult = await pool.query(
      `SELECT
        id,
        email,
        first_name,
        last_name,
        phone,
        company_name,
        role,
        is_active,
        email_verified,
        archived_at,
        archived_reason,
        created_at,
        referral_code,
        updated_at
       FROM users
       ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      count: usersResult.rows.length,
      data: usersResult.rows
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

// Get user by ID (Only for admin_c)
const getUserById = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view user details.'
      });
    }

    const { id } = req.params;

    // Fetch user by ID with all fields except password_hash
    const userResult = await pool.query(
      `SELECT 
        id, 
        email, 
        first_name, 
        last_name, 
        phone, 
        company_name, 
        role, 
        is_active,
        referral_code,
        created_at,
        updated_at
       FROM users 
       WHERE id = $1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userResult.rows[0]
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user details'
    });
  }
};

// Update user status (Approve/Deactivate - Only for admin_c)
const updateUserStatus = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can update user status.'
      });
    }

    const { id } = req.params;
    const { is_active, reason } = req.body; // Added reason parameter for rejection

    // Validate input
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active must be a boolean value'
      });
    }

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, role, email, first_name, last_name FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userCheck.rows[0];

    // Update user status
    const result = await pool.query(
      `UPDATE users 
       SET is_active = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, updated_at`,
      [is_active, id]
    );

    const action = is_active ? 'approved' : 'rejected';
    
    // 🚀 Send email notification to the user
    try {
      // Import emailTemplates inside the function to avoid circular dependencies
      const { emailTemplates } = require('../../services/emailService');
      
      // Only send approval/rejection emails for admin_a users
      if (user.role === 'admin_a') {
        // Send appropriate email based on action using your existing template structure
        if (is_active) {
          // User is approved
          await emailTemplates.approvalStatus(user, 'approved');
          console.log(`📧 Approval email sent to ${user.email}`);
        } else {
          // User is rejected - pass the reason if provided
          const rejectionReason = reason || 'Your application did not meet the eligibility criteria.';
          await emailTemplates.approvalStatus(user, 'rejected', rejectionReason);
          console.log(`📧 Rejection email sent to ${user.email}`);
        }
      }
    } catch (emailError) {
      // Log email error but don't fail the status update
      console.error('⚠️ Failed to send status update email:', emailError.message);
    }

    res.json({
      success: true,
      message: `User ${action} successfully`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

// Get pending Sub Consultants (admin_a with is_active = false)
const getPendingSubConsultants = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view pending applications.'
      });
    }

    // Fetch pending Sub Consultants
    const pendingUsers = await pool.query(
      `SELECT 
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
       WHERE role = 'admin_a' AND is_active IS NULL
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      count: pendingUsers.rows.length,
      data: pendingUsers.rows
    });

  } catch (error) {
    console.error('Get pending sub consultants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending applications'
    });
  }
};


const getRejectedSubConsultants = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view pending applications.'
      });
    }

    // Fetch pending Sub Consultants
    const pendingUsers = await pool.query(
      `SELECT 
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
       WHERE role = 'admin_a' AND is_active = false
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      count: pendingUsers.rows.length,
      data: pendingUsers.rows
    });

  } catch (error) {
    console.error('Get pending sub consultants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending applications'
    });
  }
};

// Delete user (Only for admin_c)
const deleteUser = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can delete users.'
      });
    }

    const { id } = req.params;

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, role FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    // Foreign-key violation: user still has cases / activity attached.
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'This account has related cases or activity and cannot be permanently deleted. Use "Done Working With" to archive it instead.'
      });
    }
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user'
    });
  }
};

// Archive / restore a partner account ("Done Working With")
const archiveUser = async (req, res) => {
  try {
    if (!['admin_b', 'admin_c'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      });
    }

    const { id } = req.params;
    const { archived, reason } = req.body;

    if (typeof archived !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'archived must be a boolean value'
      });
    }

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot archive your own account'
      });
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await pool.query(
      archived
        ? `UPDATE users
             SET archived_at = NOW(), archived_by = $2, archived_reason = $3,
                 is_active = false, updated_at = NOW()
           WHERE id = $1
           RETURNING id, email, first_name, last_name, company_name, role, is_active, archived_at, archived_reason`
        : `UPDATE users
             SET archived_at = NULL, archived_by = NULL, archived_reason = NULL, updated_at = NOW()
           WHERE id = $1
           RETURNING id, email, first_name, last_name, company_name, role, is_active, archived_at, archived_reason`,
      archived ? [id, req.user.id, reason || null] : [id]
    );

    res.json({
      success: true,
      message: archived ? 'Account archived' : 'Account restored',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Archive user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating archive status'
    });
  }
};

// GET /api/auth/verify-email/:token
const verifyEmailToken = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Verification token is required' });
    }

    const result = await pool.query(
      `SELECT id, email, email_verified, email_verification_expires
       FROM users WHERE email_verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or already-used verification link.' });
    }

    const user = result.rows[0];
    if (user.email_verified) {
      return res.json({ success: true, message: 'Email already verified. You can log in once approved.', data: { email: user.email } });
    }
    if (user.email_verification_expires && new Date(user.email_verification_expires) < new Date()) {
      return res.status(400).json({ success: false, status: 'expired', message: 'This verification link has expired. Please request a new one.' });
    }

    await pool.query(
      `UPDATE users
         SET email_verified = true, email_verification_token = NULL,
             email_verification_expires = NULL, updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    res.json({ success: true, message: 'Email verified successfully.', data: { email: user.email } });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: 'Server error during email verification' });
  }
};

// POST /api/auth/resend-verification  { email }
const resendVerification = async (req, res) => {
  const genericResponse = () =>
    res.json({ success: true, message: 'If that account exists and is unverified, a new verification email has been sent.' });

  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, email_verified FROM users WHERE email = $1`,
      [email]
    );
    if (result.rows.length === 0 || result.rows[0].email_verified) {
      return genericResponse();
    }

    const user = result.rows[0];
    const newToken = makeVerificationToken();
    await pool.query(
      `UPDATE users
         SET email_verification_token = $2,
             email_verification_expires = $3,
             updated_at = NOW()
       WHERE id = $1`,
      [user.id, newToken, new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)]
    );

    try {
      await sendVerificationEmail(user, newToken);
    } catch (mailErr) {
      console.error('Resend verification email error:', mailErr.message);
    }

    return genericResponse();
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update module.exports at the end of the file
module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  getAllUsers,
  getUserById,
  updateUserStatus,
  getPendingSubConsultants,
  getRejectedSubConsultants,
  deleteUser,
  archiveUser,
  verifyEmailToken,
  resendVerification
};