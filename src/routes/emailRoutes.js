const express = require('express');
const router = express.Router();
const { emailTemplates, sendEmail } = require('../../services/emailService');

// Health check for email service
router.get('/status', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'Brevo SMTP',
    timestamp: new Date().toISOString()
  });
});

// Send welcome email
router.post('/welcome', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ 
        error: 'Email and name are required' 
      });
    }

    const result = await emailTemplates.welcome(email, name);
    
    res.json({
      success: true,
      message: 'Welcome email sent',
      messageId: result.messageId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send order confirmation
router.post('/order-confirmation', async (req, res) => {
  try {
    const { email, orderData } = req.body;
    
    if (!email || !orderData) {
      return res.status(400).json({ 
        error: 'Email and order data required' 
      });
    }

    const result = await emailTemplates.orderConfirmation(email, orderData);
    
    res.json({
      success: true,
      message: 'Order confirmation sent',
      messageId: result.messageId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send password reset
router.post('/password-reset', async (req, res) => {
  try {
    const { email, name, resetLink } = req.body;
    
    if (!email || !name || !resetLink) {
      return res.status(400).json({ 
        error: 'Email, name, and reset link required' 
      });
    }

    const result = await emailTemplates.passwordReset(email, name, resetLink);
    
    res.json({
      success: true,
      message: 'Password reset email sent',
      messageId: result.messageId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send custom email
router.post('/custom', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body;
    
    if (!to || !subject || !html) {
      return res.status(400).json({ 
        error: 'To, subject, and html are required' 
      });
    }

    const result = await sendEmail({ to, subject, html, text });
    
    res.json({
      success: true,
      message: 'Email sent',
      messageId: result.messageId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send bulk emails (max 10 per request for safety)
router.post('/bulk', async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Emails array required' });
    }

    if (emails.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 emails per bulk request' });
    }

    const results = await Promise.allSettled(
      emails.map(emailData => sendEmail(emailData))
    );

    const summary = {
      total: emails.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      details: results.map((r, i) => ({
        email: emails[i].to,
        status: r.status,
        ...(r.status === 'fulfilled' 
          ? { messageId: r.value.messageId } 
          : { error: r.reason.message })
      }))
    };

    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});




module.exports = router;