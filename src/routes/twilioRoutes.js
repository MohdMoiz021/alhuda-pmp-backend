const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const fs = require('fs');  // Add this
const path = require('path'); // Add this

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ======================================
// Phone to Case Mapping Functions
// ======================================
const mappingFile = path.join(__dirname, '../phone-mapping.json');

// Load mappings from file
function loadMappings() {
  try {
    // Check if file exists
    if (fs.existsSync(mappingFile)) {
      const data = fs.readFileSync(mappingFile, 'utf8');
      return JSON.parse(data);
    } else {
      // Create empty file if it doesn't exist
      fs.writeFileSync(mappingFile, JSON.stringify({}, null, 2));
      return {};
    }
  } catch (error) {
    console.error('Error loading mappings:', error);
    return {};
  }
}

// Save mappings to file
function saveMappings(mappings) {
  try {
    fs.writeFileSync(mappingFile, JSON.stringify(mappings, null, 2));
    console.log('✅ Mappings saved to file');
  } catch (error) {
    console.error('Error saving mappings:', error);
  }
}

// Get case ID from phone number
function getCaseIdFromPhoneNumber(phoneNumber) {
  const mappings = loadMappings();
  const cleanPhone = phoneNumber.replace('whatsapp:', '').replace('+', '');
  return mappings[cleanPhone];
}

// ======================================
// API Endpoints
// ======================================

/**
 * Map phone number to case ID
 * POST /api/twilio/map-phone-to-case
 */
router.post('/map-phone-to-case', (req, res) => {
  try {
    const { phoneNumber, caseId } = req.body;
    
    if (!phoneNumber || !caseId) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and case ID are required'
      });
    }

    // Clean the phone number
    const cleanPhone = phoneNumber.replace('whatsapp:', '').replace('+', '');
    
    // Load existing mappings
    const mappings = loadMappings();
    
    // Add new mapping
    mappings[cleanPhone] = caseId;
    
    // Save back to file
    saveMappings(mappings);
    
    console.log(`📌 Mapped ${cleanPhone} → Case ${caseId}`);

    res.json({
      success: true,
      message: 'Phone number mapped to case successfully'
    });

  } catch (error) {
    console.error('Error mapping phone to case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to map phone to case'
    });
  }
});

/**
 * Send WhatsApp message via Twilio
 * POST /api/twilio/send-message
 */
/**
 * Send WhatsApp message via Twilio
 * POST /api/twilio/send-message
 * 
 * 
 */



/**
 * DEBUG: List all recent messages
 * GET /api/twilio/debug/messages
 */
router.get('/debug/messages', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // Get most recent messages
    const messages = await client.messages.list({ limit: parseInt(limit) });
    
    const formattedMessages = messages.map(msg => ({
      sid: msg.sid,
      from: msg.from,
      to: msg.to,
      direction: msg.direction,
      body: msg.body.substring(0, 50),
      dateCreated: msg.dateCreated,
      status: msg.status
    }));
    
    res.json({
      success: true,
      total: messages.length,
      messages: formattedMessages
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Debug endpoint to see ALL recent messages (no filter)
 * GET /api/twilio/debug/all
 * 
 * 
 * 
 * 
 */
router.get('/debug/all', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    // Get ALL recent messages
    const messages = await client.messages.list({ limit: parseInt(limit) });
    
    const formatted = messages.map(msg => ({
      sid: msg.sid,
      from: msg.from,
      to: msg.to,
      body: msg.body.substring(0, 30),
      direction: msg.direction,
      date: msg.dateCreated,
      status: msg.status
    }));
    
    // Get unique phone numbers
    const uniqueNumbers = new Set();
    messages.forEach(msg => {
      if (msg.from) uniqueNumbers.add(msg.from.replace('whatsapp:', ''));
      if (msg.to) uniqueNumbers.add(msg.to.replace('whatsapp:', ''));
    });
    
    res.json({
      success: true,
      total: messages.length,
      uniqueNumbers: Array.from(uniqueNumbers),
      messages: formatted
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * TEST endpoint - FIXED VERSION
 * GET /api/twilio/test-messages/:phoneNumber
 */
router.get('/test-messages/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    console.log('🔍 Test endpoint - raw phone:', phoneNumber);
    
    // Decode URL encoding
    phoneNumber = decodeURIComponent(phoneNumber);
    console.log('🔍 After decode:', phoneNumber);
    
    // Remove any whatsapp: prefix
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    console.log('🔍 After removing whatsapp:', phoneNumber);
    
    // Ensure it has + prefix
    let twilioNumber = phoneNumber;
    if (!twilioNumber.startsWith('+')) {
      twilioNumber = '+' + twilioNumber;
    }
    console.log('🔍 Final number for Twilio:', twilioNumber);
    
    // Get messages where this number is the recipient
    console.log(`📊 Fetching messages TO ${twilioNumber}...`);
    const toMessages = await client.messages.list({
      to: twilioNumber,
      limit: 50
    });
    console.log(`📊 Found ${toMessages.length} messages TO this number`);
    
    // Get messages where this number is the sender
    console.log(`📊 Fetching messages FROM ${twilioNumber}...`);
    const fromMessages = await client.messages.list({
      from: twilioNumber,
      limit: 50
    });
    console.log(`📊 Found ${fromMessages.length} messages FROM this number`);
    
    // If still no messages, try without the + prefix as fallback
    if (toMessages.length === 0 && fromMessages.length === 0) {
      console.log('⚠️ No messages found, trying without + prefix...');
      const withoutPlus = twilioNumber.replace('+', '');
      
      const toFallback = await client.messages.list({
        to: withoutPlus,
        limit: 50
      });
      
      const fromFallback = await client.messages.list({
        from: withoutPlus,
        limit: 50
      });
      
      console.log(`Fallback - TO: ${toFallback.length}, FROM: ${fromFallback.length}`);
      
      return res.json({
        success: true,
        phoneNumber: twilioNumber,
        fallback: true,
        toMessages: toFallback.map(m => ({
          sid: m.sid,
          body: m.body,
          from: m.from,
          to: m.to,
          direction: m.direction,
          date: m.dateCreated
        })),
        fromMessages: fromFallback.map(m => ({
          sid: m.sid,
          body: m.body,
          from: m.from,
          to: m.to,
          direction: m.direction,
          date: m.dateCreated
        })),
        toCount: toFallback.length,
        fromCount: fromFallback.length,
        total: toFallback.length + fromFallback.length
      });
    }
    
    // Return formatted results
    res.json({
      success: true,
      phoneNumber: twilioNumber,
      toMessages: toMessages.map(m => ({
        sid: m.sid,
        body: m.body,
        from: m.from,
        to: m.to,
        direction: m.direction,
        date: m.dateCreated,
        status: m.status
      })),
      fromMessages: fromMessages.map(m => ({
        sid: m.sid,
        body: m.body,
        from: m.from,
        to: m.to,
        direction: m.direction,
        date: m.dateCreated,
        status: m.status
      })),
      toCount: toMessages.length,
      fromCount: fromMessages.length,
      total: toMessages.length + fromMessages.length
    });
    
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
});

/**
 * DEBUG: Check messages for specific number
 * GET /api/twilio/debug/check-number/:phoneNumber
 */
router.get('/debug/check-number/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    // Try different formats
    const formats = [
      phoneNumber, // as is
      `+${phoneNumber.replace('+', '')}`, // ensure + prefix
      `whatsapp:${phoneNumber.replace('whatsapp:', '')}`, // with whatsapp prefix
      `+${phoneNumber.replace(/\D/g, '')}`, // just digits with +
    ];
    
    const results = {};
    
    for (const format of formats) {
      // Remove whatsapp: for API call
      const apiFormat = format.replace('whatsapp:', '');
      
      const toMessages = await client.messages.list({ 
        to: apiFormat,
        limit: 10 
      });
      
      const fromMessages = await client.messages.list({ 
        from: apiFormat,
        limit: 10 
      });
      
      results[format] = {
        to: toMessages.length,
        from: fromMessages.length,
        total: toMessages.length + fromMessages.length,
        sampleTo: toMessages[0] ? {
          body: toMessages[0].body.substring(0, 30),
          date: toMessages[0].dateCreated
        } : null,
        sampleFrom: fromMessages[0] ? {
          body: fromMessages[0].body.substring(0, 30),
          date: fromMessages[0].dateCreated
        } : null
      };
    }
    
    res.json({
      success: true,
      phoneNumber: phoneNumber,
      results: results
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.post('/send-message', async (req, res) => {
  try {
    const { to, body, caseId } = req.body;

    console.log('📤 Sending message:', { 
      to, 
      body: body.substring(0, 50) + '...', 
      caseId 
    });

    if (!to || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Ensure 'to' has whatsapp: prefix and proper + format
    let formattedTo = to;
    if (!formattedTo.includes('whatsapp:')) {
      formattedTo = `whatsapp:${formattedTo}`;
    }
    
    // Ensure the number part has + prefix
    const numberPart = formattedTo.replace('whatsapp:', '');
    if (!numberPart.startsWith('+')) {
      formattedTo = `whatsapp:+${numberPart}`;
    }

    console.log('📞 Formatted recipient:', formattedTo);

    // Auto-map this phone to case when sending first message
    const cleanPhone = formattedTo.replace('whatsapp:', '').replace('+', '');
    const mappings = loadMappings();
    if (!mappings[cleanPhone]) {
      mappings[cleanPhone] = caseId;
      saveMappings(mappings);
      console.log(`📌 Auto-mapped ${cleanPhone} → Case ${caseId}`);
    }

    // Send message via Twilio
    const message = await client.messages.create({
      body: body,
      from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
      to: formattedTo
    });

    console.log(`✅ Message sent! SID: ${message.sid}`);

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      messageSid: message.sid,
      status: message.status
    });

  } catch (error) {
    console.error('❌ Twilio error:', error);
    
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
        error: 'Please join the sandbox first. Send "join [your-code]" to +14155238886'
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
 * Webhook to receive incoming WhatsApp messages
 * POST /api/twilio/webhook
 */
router.post('/webhook', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const {
      From,        // Sender's WhatsApp number
      To,          // Your Twilio number
      Body,        // Message text
      MessageSid,  // Unique message ID
      ProfileName, // Sender's WhatsApp name
      MediaUrl0,   // Optional media URL
      MediaContentType0
    } = req.body;

    console.log('📩 Incoming WhatsApp message:', {
      from: From,
      body: Body,
      name: ProfileName,
      sid: MessageSid
    });

    // Extract phone number
    const clientNumber = From.replace('whatsapp:', '');
    
    // Get case ID from mapping
    const caseId = getCaseIdFromPhoneNumber(clientNumber);
    
    if (!caseId) {
      console.log('⚠️ No case mapping found for phone:', clientNumber);
      // Still respond to Twilio
      return res.send('<Response></Response>');
    }

    // Create message object
    const incomingMessage = {
      id: MessageSid,
      caseId: caseId,
      conversationId: clientNumber,
      senderId: clientNumber,
      senderName: ProfileName || 'Client',
      senderRole: 'client',
      content: Body,
      messageType: MediaUrl0 ? 'file' : 'text',
      fileUrl: MediaUrl0 || null,
      fileName: MediaUrl0 ? 'Attachment' : null,
      createdAt: new Date().toISOString(),
      isFromClient: true,
      readBy: []
    };

    // Emit via WebSocket to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`case_${caseId}`).emit('new_message', incomingMessage);
      console.log(`📤 Emitted to case_${caseId} room`);
    }

    // Respond to Twilio
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('<Response></Response>');
  }
});

/**
 * Get message history from Twilio
 * GET /api/twilio/messages/:phoneNumber
 */
/**
 * Get message history from Twilio
 * GET /api/twilio/messages/:phoneNumber
 */
/**
 * Get message history from Twilio
 * GET /api/twilio/messages/:phoneNumber
 */
/**
 * Get message history from Twilio
 * GET /api/twilio/messages/:phoneNumber
 */
/**
 * Get message history from Twilio
 * GET /api/twilio/messages/:phoneNumber
 */
/**
 * SIMPLIFIED version - guaranteed to work
 */
router.get('/messages/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    // Decode and format
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    
    // Ensure + prefix
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    console.log('Fetching messages for:', phoneNumber);
    
    // Get ALL recent messages (no filter first to debug)
    const allRecentMessages = await client.messages.list({ limit: 100 });
    
    // Filter manually
    const relevantMessages = allRecentMessages.filter(msg => 
      msg.to === `whatsapp:${phoneNumber}` || 
      msg.from === `whatsapp:${phoneNumber}` ||
      msg.to === phoneNumber || 
      msg.from === phoneNumber
    );
    
    console.log(`Found ${relevantMessages.length} relevant messages`);
    
    // Format
    const formatted = relevantMessages.map(msg => ({
      id: msg.sid,
      content: msg.body,
      senderId: msg.direction === 'inbound' ? msg.from : 'admin',
      senderName: msg.direction === 'inbound' ? 'Client' : 'You',
      senderRole: msg.direction === 'inbound' ? 'client' : 'admin',
      isFromClient: msg.direction === 'inbound',
      createdAt: msg.dateCreated,
      status: msg.status
    }));
    
    res.json({
      success: true,
      messages: formatted,
      count: formatted.length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * TEST endpoint - direct mirror of your debug
 * GET /api/twilio/test-messages/:phoneNumber
 */
router.get('/test-messages/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    // Decode and format
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    // Get messages
    const toMessages = await client.messages.list({ to: phoneNumber, limit: 50 });
    const fromMessages = await client.messages.list({ from: phoneNumber, limit: 50 });
    
    // Return raw Twilio data
    res.json({
      success: true,
      phoneNumber: phoneNumber,
      toMessages: toMessages.map(m => ({
        sid: m.sid,
        body: m.body,
        from: m.from,
        to: m.to,
        direction: m.direction,
        date: m.dateCreated
      })),
      fromMessages: fromMessages.map(m => ({
        sid: m.sid,
        body: m.body,
        from: m.from,
        to: m.to,
        direction: m.direction,
        date: m.dateCreated
      })),
      toCount: toMessages.length,
      fromCount: fromMessages.length,
      total: toMessages.length + fromMessages.length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all mappings
 * GET /api/twilio/mappings
 */
router.get('/mappings', (req, res) => {
  const mappings = loadMappings();
  res.json({
    success: true,
    mappings: mappings
  });
});

/**
 * Twilio status check
 * GET /api/twilio/status
 */
router.get('/status', async (req, res) => {
  try {
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    
    res.json({
      success: true,
      message: 'Twilio is configured correctly',
      account: {
        name: account.friendlyName,
        status: account.status,
        type: account.type
      },
      whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'
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
 * Sandbox info
 * GET /api/twilio/sandbox
 */
router.get('/sandbox', (req, res) => {
  res.json({
    success: true,
    sandboxNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    instructions: 'Send "join [your-code]" to this number to join the sandbox',
    joinCode: process.env.TWILIO_SANDBOX_CODE || 'join-something'
  });
});

module.exports = router;





