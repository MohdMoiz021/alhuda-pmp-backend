const express = require('express');
const router = express.Router();
const twilio = require('twilio');

// Initialize Twilio client directly in the route file
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Send WhatsApp message via Twilio
 * POST /api/twilio/send-message
 */
router.post('/send-message', async (req, res) => {
  try {
    const { to, body, caseId } = req.body;

    console.log('Received request:', { to, body, caseId });

    // Validate required fields
    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number (to) is required'
      });
    }

    if (!body) {
      return res.status(400).json({
        success: false,
        message: 'Message body is required'
      });
    }

    // Ensure 'to' has whatsapp: prefix
    const formattedTo = to.includes('whatsapp:') ? to : `whatsapp:${to}`;

    console.log(`Sending WhatsApp message to ${formattedTo}`);

    // Send message via Twilio
    const message = await client.messages.create({
      body: body,
      from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
      to: formattedTo
    });

    console.log(`Message sent successfully! SID: ${message.sid}`);

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      messageSid: message.sid,
      status: message.status
    });

  } catch (error) {
    console.error('Twilio error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo
    });

    // Handle specific Twilio errors
    if (error.code === 21211) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
        error: 'Please check the phone number format'
      });
    }

    if (error.code === 21408) {
      return res.status(400).json({
        success: false,
        message: 'This number is not registered in your Twilio sandbox',
        error: 'Please join the sandbox first'
      });
    }

    if (error.code === 20003) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed - check your Twilio credentials',
        error: 'Invalid Twilio credentials'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send WhatsApp message',
      error: error.message,
      code: error.code
    });
  }
});

/**
 * Check Twilio account status
 * GET /api/twilio/status
 */
router.get('/status', async (req, res) => {
  try {
    // Try to fetch account info to verify credentials
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    
    res.json({
      success: true,
      message: 'Twilio is configured correctly',
      account: {
        name: account.friendlyName,
        status: account.status,
        type: account.type
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Twilio configuration error',
      error: error.message
    });
  }
});

/**
 * Get Twilio sandbox info
 * GET /api/twilio/sandbox
 */
router.get('/sandbox', (req, res) => {
  res.json({
    success: true,
    sandboxNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    instructions: 'Send "join [your-code]" to this number to join the sandbox'
  });
});

module.exports = router;