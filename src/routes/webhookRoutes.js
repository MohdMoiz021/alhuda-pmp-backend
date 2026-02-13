const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { saveMessage, getConversation } = require('../../services/databaseService');

/**
 * TWILIO WEBHOOK - CRITICAL ENDPOINT
 * This is where Twilio sends ALL incoming WhatsApp messages
 */
router.post('/twilio-webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Twilio sends data as form-urlencoded
    const {
      From,        // Sender's WhatsApp number: "whatsapp:+1234567890"
      To,          // Your Twilio number: "whatsapp:+14155238886"
      Body,        // Message text
      MessageSid,  // Unique message ID
      ProfileName, // Sender's WhatsApp name
      MediaUrl0,   // Optional: Media URL if file sent
      MediaContentType0 // Optional: File type
    } = req.body;

    console.log('📩 Received WhatsApp message:', {
      from: From,
      body: Body,
      name: ProfileName
    });

    // Extract clean phone number (remove "whatsapp:" prefix)
    const clientNumber = From.replace('whatsapp:', '');
    
    // Find which case this client is associated with
    // You need to map phone numbers to cases in your database
    const caseId = await getCaseIdFromPhoneNumber(clientNumber);
    
    // Save message to your database
    await saveMessage({
      caseId,
      conversationId: clientNumber, // Or your conversation ID logic
      senderId: clientNumber,
      senderName: ProfileName || 'Client',
      senderRole: 'client',
      content: Body,
      messageType: MediaUrl0 ? 'file' : 'text',
      fileUrl: MediaUrl0,
      fileName: MediaUrl0 ? Body : null,
      createdAt: new Date(),
      isFromClient: true
    });

    // Emit via WebSocket to your admin dashboard
    // This is how admin sees messages in real-time
    if (req.io) {
      req.io.to(`case_${caseId}`).emit('new_message', {
        conversationId: clientNumber,
        message: Body,
        sender: 'client',
        timestamp: new Date()
      });
    }

    // ⚠️ CRITICAL: You MUST respond to Twilio within 15 seconds
    // Otherwise Twilio will retry and mark your endpoint as failing
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <!-- Empty response acknowledges receipt -->
      </Response>
    `);

  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Still respond with 200 to stop Twilio from retrying
    res.status(200).send('<Response></Response>');
  }
});

/**
 * API endpoint for admin to send messages
 */
router.post('/send-message', express.json(), async (req, res) => {
  try {
    const { caseId, clientNumber, message, mediaUrl } = req.body;
    
    // Get client's WhatsApp number from your database
    const formattedNumber = formatWhatsAppNumber(clientNumber);
    
    // Send via Twilio
    const result = await sendWhatsAppMessage(formattedNumber, message, mediaUrl);
    
    if (result.success) {
      // Save to database
      await saveMessage({
        caseId,
        senderId: req.user.id, // Your admin user ID
        senderName: req.user.name,
        senderRole: 'admin',
        content: message,
        messageType: mediaUrl ? 'file' : 'text',
        fileUrl: mediaUrl,
        createdAt: new Date(),
        isFromClient: false
      });
      
      res.json({ success: true, messageSid: result.messageSid });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;