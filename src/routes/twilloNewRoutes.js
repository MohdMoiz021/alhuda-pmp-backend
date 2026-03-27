const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const emailService = require('../../services/emailService');
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
    if (fs.existsSync(mappingFile)) {
      const data = fs.readFileSync(mappingFile, 'utf8');
      return JSON.parse(data);
    } else {
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

// Store conversation metadata (for template tracking)
const conversationMetadata = new Map();

// ======================================
// Helper Functions
// ======================================

// Format status for display
const formatStatus = (status) => {
  const statusMap = {
    'approved': '✅ APPROVED',
    'rejected': '❌ REJECTED',
    'pending': '⏳ PENDING REVIEW',
    'review': '📋 NEEDS MORE INFO'
  };
  return statusMap[status.toLowerCase()] || status.toUpperCase();
};

// Check if 24-hour window is open
const isWindowOpen = async (phoneNumber) => {
  try {
    const formattedNumber = `whatsapp:${phoneNumber}`;
    const recentMessages = await client.messages.list({
      from: formattedNumber,
      dateSentAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 1
    });
    return recentMessages.length > 0;
  } catch (error) {
    console.error('Error checking window:', error);
    return false;
  }
};

// ======================================
// NEW: Send Template Message with Custom Content
// ======================================

/**
 * Send custom template message to partner
 * POST /api/twilio/send-template
 * 
 * Body: {
 *   partnerName: string,
 *   partnerPhone: string,
 *   caseNumber: string,
 *   customMessage: string,
 *   caseId: string (optional, for mapping)
 * }
 */
/**
 * Send template message (FIRST MESSAGE ONLY)
 * POST /api/twilio/send-template
 */
router.post('/send-template', async (req, res) => {
  try {
    const { partnerName, partnerPhone, caseNumber, customMessage, caseId } = req.body;
    
    if (!partnerName || !partnerPhone || !caseNumber || !customMessage) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const formattedTo = `whatsapp:${partnerPhone}`;
    
    // Build template message
    const messageBody = `Dear ${partnerName},\n\nRegarding case ${caseNumber}: ${customMessage}\n\nPlease reply if you have any questions.`;
    
    // Send the message
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo,
      body: messageBody
    });
    
    // Store conversation metadata
    conversationMetadata.set(partnerPhone, {
      partnerName,
      caseNumber,
      lastTemplateSent: new Date(),
      lastTemplateSid: message.sid,
      hasReplied: false
    });

        // SEND EMAIL NOTIFICATIONS (only for first message)
    const sentAt = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'medium'
    });
    
    // Email to Admin
    if (adminEmail && adminName) {
      await emailService.emailTemplates.whatsappFirstMessageToAdmin({
        admin_name: adminName,
        admin_email: adminEmail,
        partner_name: partnerName,
        partner_phone: partnerPhone,
        case_reference: caseNumber,
        case_id: caseId,
        message_content: customMessage,
        sent_at: sentAt
      });
      console.log(`📧 Email sent to admin: ${adminEmail}`);
    }
    
    // Email to Partner
    if (partnerEmail) {
      await emailService.emailTemplates.whatsappFirstMessageToPartner({
        partner_name: partnerName,
        partner_email: partnerEmail,
        partner_phone: partnerPhone,
        case_reference: caseNumber,
        case_id: caseId,
        message_content: customMessage,
        sent_at: sentAt,
        admin_name: adminName || 'Admin'
      });
      console.log(`📧 Email sent to partner: ${partnerEmail}`);
    }
    
    console.log(`✅ Template sent to ${partnerName} (${partnerPhone})`);
    console.log(`📧 Email notifications sent for first message`);
    
    
    
    res.json({
      success: true,
      messageSid: message.sid,
      status: message.status,
      messageBody,
      note: "Template sent! Once partner replies, you can chat freely for 24 hours."
    });
    
  } catch (error) {
    console.error('Error sending template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Send plain text message (AFTER PARTNER REPLIES)
 * POST /api/twilio/send-plain-text
 */
router.post('/send-plain-text', async (req, res) => {
  try {
    const { partnerPhone, message, caseId } = req.body;
    
    if (!partnerPhone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const formattedTo = `whatsapp:${partnerPhone}`;
    
    // Check if window is open (partner replied in last 24h)
    const recentMessages = await client.messages.list({
      from: formattedTo,
      dateSentAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 1
    });
    
    if (recentMessages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Window closed. Send a template first.",
        requiresTemplate: true
      });
    }
    
    // Send plain text message
    const twilioMessage = await client.messages.create({
      body: message,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo
    });
    
    console.log(`💬 Plain text sent to ${partnerPhone}: ${message.substring(0, 50)}...`);
    
    res.json({
      success: true,
      messageSid: twilioMessage.sid,
      status: twilioMessage.status,
      messageType: 'plain-text'
    });
    
  } catch (error) {
    console.error('Error sending plain text:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check if window is open for plain text chat
 * GET /api/twilio/check-window/:phoneNumber
 */
router.get('/check-window/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    const formattedNumber = `whatsapp:${phoneNumber}`;
    
    const recentMessages = await client.messages.list({
      from: formattedNumber,
      dateSentAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 1
    });
    
    const windowOpen = recentMessages.length > 0;
    const lastMessage = recentMessages[0];
    
    let timeRemaining = null;
    if (windowOpen && lastMessage) {
      const expiresAt = new Date(lastMessage.dateCreated);
      expiresAt.setHours(expiresAt.getHours() + 24);
      const now = new Date();
      const hoursLeft = Math.floor((expiresAt - now) / (1000 * 60 * 60));
      const minutesLeft = Math.floor(((expiresAt - now) % (1000 * 60 * 60)) / (1000 * 60));
      timeRemaining = `${hoursLeft}h ${minutesLeft}m`;
    }
    
    res.json({
      success: true,
      windowOpen,
      canSendPlainText: windowOpen,
      mustUseTemplate: !windowOpen,
      lastMessageTime: lastMessage?.dateCreated,
      timeRemaining
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ======================================
// Enhanced Send Message (with window check)
// ======================================

/**
 * Send WhatsApp message (intelligently chooses template or freeform)
 * POST /api/twilio/send-message
 * 
 * Body: {
 *   to: string,
 *   body: string,
 *   caseId: string,
 *   isReply: boolean (optional)
 * }
 */
router.post('/send-message', async (req, res) => {
  try {
    let { to, body, caseId, isReply } = req.body;

    console.log('📤 Sending message:', { 
      to, 
      body: body.substring(0, 50) + '...', 
      caseId,
      isReply 
    });

    if (!to || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Format the phone number
    let formattedTo = to;
    if (!formattedTo.includes('whatsapp:')) {
      formattedTo = `whatsapp:${formattedTo}`;
    }
    
    const numberPart = formattedTo.replace('whatsapp:', '');
    if (!numberPart.startsWith('+')) {
      formattedTo = `whatsapp:+${numberPart}`;
    }

    const cleanPhone = numberPart.replace('+', '');
    
    // Check if this is a reply (freeform) or new conversation
    let message;
    const windowOpen = await isWindowOpen(cleanPhone);
    
    if (windowOpen || isReply) {
      // Window is open - send freeform
      message = await client.messages.create({
        body: body,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      
      console.log(`✅ Freeform reply sent! SID: ${message.sid}`);
    } else {
      // Window closed - need to use template format
      // Get partner info from mapping
      const existingCaseId = getCaseIdFromPhoneNumber(cleanPhone);
      const partnerName = body.split(' ')[0] || 'Partner'; // Fallback
      const caseNumber = caseId || existingCaseId || 'CASE-UNKNOWN';
      
      // Format as template
      const messageBody = `Dear ${partnerName},\n\nRegarding case ${caseNumber}: ${body}\n\nPlease reply if you have any questions.`;
      
      message = await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      
      console.log(`⚠️ Window closed - sent as template! SID: ${message.sid}`);
    }
    
    // Auto-map this phone to case
    if (caseId) {
      const mappings = loadMappings();
      if (!mappings[cleanPhone]) {
        mappings[cleanPhone] = caseId;
        saveMappings(mappings);
        console.log(`📌 Auto-mapped ${cleanPhone} → Case ${caseId}`);
      }
    }
    
    // Emit via WebSocket
    const io = req.app.get('io');
    if (io && caseId) {
      io.to(`case_${caseId}`).emit('new_message', {
        id: message.sid,
        content: body,
        senderRole: 'admin',
        createdAt: new Date(),
        status: message.status
      });
    }

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      messageSid: message.sid,
      status: message.status,
      messageType: (windowOpen || isReply) ? 'freeform' : 'template'
    });

  } catch (error) {
    console.error('❌ Twilio error:', error);
    
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

// ======================================
// Send Freeform Reply (explicit)
// ======================================

/**
 * Send freeform reply (only works if window is open)
 * POST /api/twilio/send-reply
 * 
 * Body: { partnerPhone, message, caseId }
 */
router.post('/send-reply', async (req, res) => {
  try {
    const { partnerPhone, message, caseId } = req.body;
    
    if (!partnerPhone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: partnerPhone, message'
      });
    }
    
    const formattedTo = `whatsapp:${partnerPhone}`;
    
    // Check if window is open
    const windowOpen = await isWindowOpen(partnerPhone);
    
    if (!windowOpen) {
      return res.status(400).json({
        success: false,
        error: "24-hour window is closed",
        action: "Send a template first using /api/twilio/send-template",
        tip: "Partner hasn't replied in the last 24 hours. Send a template to reopen the conversation."
      });
    }
    
    // Send freeform reply
    const twilioMessage = await client.messages.create({
      body: message,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo
    });
    
    // Update conversation metadata
    const cleanPhone = partnerPhone.replace('whatsapp:', '').replace('+', '');
    if (conversationMetadata.has(cleanPhone)) {
      const conv = conversationMetadata.get(cleanPhone);
      conv.lastReply = new Date();
      conv.lastReplyMessage = message;
      conv.lastReplySid = twilioMessage.sid;
      conversationMetadata.set(cleanPhone, conv);
    }
    
    // Emit via WebSocket
    const io = req.app.get('io');
    if (io && caseId) {
      io.to(`case_${caseId}`).emit('new_message', {
        id: twilioMessage.sid,
        content: message,
        senderRole: 'admin',
        createdAt: new Date(),
        status: twilioMessage.status
      });
    }
    
    console.log(`\n💬 Reply sent to ${partnerPhone}`);
    console.log(`   Message: ${message.substring(0, 50)}...`);
    console.log(`   Message SID: ${twilioMessage.sid}\n`);
    
    res.json({
      success: true,
      messageSid: twilioMessage.sid,
      status: twilioMessage.status,
      note: "Reply sent! Window remains open for 24 hours from partner's last message."
    });
    
  } catch (error) {
    console.error('Error sending reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// ======================================
// Enhanced Message History with Case Mapping
// ======================================

/**
 * Get message history from Twilio with case mapping
 * GET /api/twilio/messages/:phoneNumber
 * Query params: caseId (optional), limit (default 100)
 */
router.get('/messages/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    const { limit = 100, caseId } = req.query;
    
    // Decode and format
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    console.log('📊 Fetching messages for:', phoneNumber);
    
    // Get messages from Twilio
    const toMessages = await client.messages.list({ 
      to: `whatsapp:${phoneNumber}`, 
      limit: parseInt(limit) 
    });
    
    const fromMessages = await client.messages.list({ 
      from: `whatsapp:${phoneNumber}`, 
      limit: parseInt(limit) 
    });
    
    const allMessages = [...toMessages, ...fromMessages];
    
    // Format messages
    const formattedMessages = allMessages.map(msg => ({
      id: msg.sid,
      content: msg.body,
      senderId: msg.direction === 'inbound' ? msg.from : 'admin',
      senderName: msg.direction === 'inbound' ? 'Partner' : 'Admin',
      senderRole: msg.direction === 'inbound' ? 'client' : 'admin',
      isFromClient: msg.direction === 'inbound',
      createdAt: msg.dateCreated,
      status: msg.status,
      direction: msg.direction
    })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    // Get case info from mapping
    const cleanPhone = phoneNumber.replace('+', '');
    const mappedCaseId = getCaseIdFromPhoneNumber(cleanPhone);
    
    // Check window status
    const windowOpen = await isWindowOpen(cleanPhone);
    
    res.json({
      success: true,
      phoneNumber: phoneNumber,
      caseId: mappedCaseId || caseId || null,
      messages: formattedMessages,
      count: formattedMessages.length,
      windowOpen: windowOpen,
      canSendFreeform: windowOpen,
      mustUseTemplate: !windowOpen
    });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ======================================
// Check Window Status
// ======================================

/**
 * Check if 24-hour window is open for partner
 * GET /api/twilio/check-window/:phoneNumber
 */
router.get('/check-window/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    const cleanPhone = phoneNumber.replace('+', '');
    const windowOpen = await isWindowOpen(cleanPhone);
    
    // Get last message
    const recentMessages = await client.messages.list({
      from: `whatsapp:${phoneNumber}`,
      limit: 1
    });
    
    const lastMessage = recentMessages[0];
    let timeRemaining = null;
    
    if (windowOpen && lastMessage) {
      const expiresAt = new Date(lastMessage.dateCreated);
      expiresAt.setHours(expiresAt.getHours() + 24);
      const now = new Date();
      const hoursLeft = Math.floor((expiresAt - now) / (1000 * 60 * 60));
      const minutesLeft = Math.floor(((expiresAt - now) % (1000 * 60 * 60)) / (1000 * 60));
      timeRemaining = `${hoursLeft}h ${minutesLeft}m`;
    }
    
    const caseId = getCaseIdFromPhoneNumber(cleanPhone);
    
    res.json({
      success: true,
      phoneNumber,
      caseId,
      windowOpen,
      lastMessageTime: lastMessage?.dateCreated,
      lastMessageBody: lastMessage?.body,
      timeRemaining,
      canSendFreeform: windowOpen,
      mustUseTemplate: !windowOpen,
      message: windowOpen ? 
        `✅ Window open! You can send freeform messages for next ${timeRemaining}.` : 
        "⚠️ Window closed. Send a template first using /api/twilio/send-template"
    });
    
  } catch (error) {
    console.error('Error checking window:', error);
    res.status(500).json({ error: error.message });
  }
});

// ======================================
// Webhook for Incoming WhatsApp Messages
// ======================================

/**
 * Webhook to receive incoming WhatsApp messages
 * POST /api/twilio/webhook
 */
router.post('/webhook', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const { From, To, Body, MessageSid, ProfileName, MediaUrl0, MediaContentType0 } = req.body;

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

    // Update conversation metadata
    const cleanPhone = clientNumber.replace('+', '');
    if (conversationMetadata.has(cleanPhone)) {
      const conv = conversationMetadata.get(cleanPhone);
      conv.hasReplied = true;
      conv.lastReply = new Date();
      conv.lastReplyMessage = Body;
      conversationMetadata.set(cleanPhone, conv);
    } else {
      conversationMetadata.set(cleanPhone, {
        partnerName: ProfileName || clientNumber,
        phoneNumber: cleanPhone,
        hasReplied: true,
        firstMessage: Body,
        firstMessageTime: new Date()
      });
    }

    // Create message object
    const incomingMessage = {
      id: MessageSid,
      caseId: caseId,
      conversationId: clientNumber,
      senderId: clientNumber,
      senderName: ProfileName || 'Partner',
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
      console.log(`📤 Emitted to case_${caseId} room - Window is NOW OPEN for 24 hours!`);
    }

    // Respond to Twilio
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('<Response></Response>');
  }
});

// ======================================
// Test Endpoint for Debugging
// ======================================

/**
 * Test endpoint to see all messages for a number
 * GET /api/twilio/test-messages/:phoneNumber
 */
router.get('/test-messages/:phoneNumber', async (req, res) => {
  try {
    let { phoneNumber } = req.params;
    
    phoneNumber = decodeURIComponent(phoneNumber);
    phoneNumber = phoneNumber.replace('whatsapp:', '');
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    const toMessages = await client.messages.list({ to: `whatsapp:${phoneNumber}`, limit: 50 });
    const fromMessages = await client.messages.list({ from: `whatsapp:${phoneNumber}`, limit: 50 });
    
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

// ======================================
// Existing Endpoints (Keep these)
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

    const cleanPhone = phoneNumber.replace('whatsapp:', '').replace('+', '');
    const mappings = loadMappings();
    mappings[cleanPhone] = caseId;
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

/**
 * Debug endpoint - all messages
 * GET /api/twilio/debug/all
 */
router.get('/debug/all', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const messages = await client.messages.list({ limit: parseInt(limit) });
    
    const formatted = messages.map(msg => ({
      sid: msg.sid,
      from: msg.from,
      to: msg.to,
      body: msg.body?.substring(0, 50),
      direction: msg.direction,
      date: msg.dateCreated,
      status: msg.status
    }));
    
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

module.exports = router;