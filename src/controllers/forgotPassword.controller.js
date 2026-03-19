// controllers/auth/forgotPasswordController.js
const pool = require('../../db');
const crypto = require('crypto');
const { emailTemplates } = require('../../services/emailService');
const { hashPassword } = require('../../src/utils/passwordUtils');


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log('🔍 Processing forgot password for:', email);

    // Check if user exists
    const userResult = await pool.query(
      `SELECT id, email, first_name, last_name, role 
       FROM users 
       WHERE email = $1 AND is_active = true`,
      [email]
    );

    // Always return success even if user doesn't exist (security)
    if (userResult.rows.length === 0) {
      console.log('ℹ️ User not found, but returning success for security');
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive reset instructions.'
      });
    }

    const user = userResult.rows[0];
    console.log('✅ User found:', { id: user.id, email: user.email, role: user.role });

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Set token expiry (1 hour from now)
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    // Save token to user in database
    await pool.query(
      `UPDATE users 
       SET reset_password_token = $1, 
           reset_password_expires = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [resetToken, resetTokenExpiry, user.id]
    );

    console.log('✅ Reset token saved to database');

    // Create reset link
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    // Prepare user name
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    
    console.log('📧 Attempting to send email to:', user.email);
    
    try {
      // FIXED: Pass the parameters correctly - as separate values, not as an object
      await emailTemplates.passwordReset({
        email: user.email,        // String email
        name: userName,           // String name
        resetLink: resetLink,     // String reset link
        role: user.role           // String role
      });
      
      console.log('✅ Password reset email sent successfully to:', user.email);
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError.message);
      console.error('❌ Full error:', emailError);
      // Don't fail the request if email fails, but log it
    }

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, you will receive reset instructions.'
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Check for password complexity (optional but recommended)
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      });
    }

    // Find user with valid token
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
        message: 'Invalid or expired reset token'
      });
    }

    const user = userResult.rows[0];

    // Hash new password

    const hashedPassword = await hashPassword(newPassword);

    // Update user password and clear reset token
    await pool.query(
      `UPDATE users 
       SET password_hash = $1,
           reset_password_token = NULL,
           reset_password_expires = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    // Send confirmation email (optional)
    try {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
      
      await emailTemplates.passwordResetConfirmation({
        email: user.email,
        name: userName
      });
      
      console.log(`✅ Password reset confirmation email sent to: ${user.email}`);
    } catch (emailError) {
      console.error('❌ Confirmation email error:', emailError.message);
      // Don't fail the password reset if confirmation email fails
    }

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
};

const verifyResetToken = async (req, res) => {
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
};

module.exports = {
  forgotPassword,
  resetPassword,
  verifyResetToken
};