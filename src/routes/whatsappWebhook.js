// routes/whatsappWebhook.js
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const twilioConversationService = require('../../services/twilioConversationService');
const { emailTemplates } = require('../../services/emailService');

// Store sent notification status to avoid multiple emails
const notificationSentCache = new Map();

router.post('/twilio-webhook', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const {
        From,
        To,
        Body,
        MessageSid,
        ProfileName,
        MediaUrl0,
        MediaContentType0
      } = req.body;

      const userPhone = From.replace('whatsapp:', '');
      const userName = ProfileName || 'Customer';
      const message = Body;
      
      console.log(`📩 WhatsApp message from ${userName} (${userPhone}): ${message}`);

      // Find which case this user is associated with
      // You need to have a mapping between user phone and case
      const caseMapping = await getCaseByUserPhone(userPhone);
      
      if (!caseMapping) {
        // No case found, send default response
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('Please provide your case ID or contact our support team.');
        return res.set('Content-Type', 'text/xml').send(twiml.toString());
      }
      
      const { caseId, userId, userName: caseUserName, userEmail, adminId, adminName, adminEmail } = caseMapping;
      
      // Get or create conversation
      const conversation = await twilioConversationService.getOrCreateCaseConversation(
        caseId, userId, caseUserName, userPhone, adminId, adminName
      );
      
      // Add message to conversation
      await twilioConversationService.sendMessage(conversation.sid, message, {
        id: userId,
        name: userName,
        role: 'customer'
      });
      
      // Send initial email notification only ONCE per case
      const cacheKey = `initial_notification_${caseId}`;
      if (!notificationSentCache.has(cacheKey)) {
        notificationSentCache.set(cacheKey, true);
        
        // Send email to admin
        await emailTemplates.whatsappConversationStarted({
          caseId: caseId,
          userName: caseUserName,
          userPhone: userPhone,
          userEmail: userEmail,
          adminName: adminName,
          adminEmail: adminEmail,
          firstMessage: message,
          messageTime: new Date()
        });
        
        console.log(`📧 Initial conversation email sent for case ${caseId}`);
        
        // Optional: Send auto-reply to customer
        await twilioConversationService.sendWhatsAppMessage(
          userPhone,
          `✅ Thank you for your message regarding Case #${caseId}. An agent will respond shortly.\n\nYou can also track your case at: ${process.env.FRONTEND_URL}/cases/${caseId}`,
          caseId
        );
      }
      
      // Acknowledge receipt
      const twiml = new twilio.twiml.MessagingResponse();
      res.set('Content-Type', 'text/xml');
      res.send(twiml.toString());
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      const twiml = new twilio.twiml.MessagingResponse();
      res.set('Content-Type', 'text/xml');
      res.send(twiml.toString());
    }
  }
);

// Helper function to get case by user phone
async function getCaseByUserPhone(phone) {
  // Query your database to find which case this user is associated with
  const query = `
    SELECT 
      c.id as case_id,
      u.id as user_id,
      u.first_name,
      u.last_name,
      u.email as user_email,
      u.phone as user_phone,
      a.id as admin_id,
      a.first_name as admin_first_name,
      a.last_name as admin_last_name,
      a.email as admin_email
    FROM case_updated c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN users a ON a.role = 'admin_c'
    WHERE u.phone = $1 OR u.whatsapp_number = $1
    ORDER BY c.created_at DESC
    LIMIT 1
  `;
  
  const result = await db.query(query, [phone]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    caseId: row.case_id,
    userId: row.user_id,
    userName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    userEmail: row.user_email,
    userPhone: row.user_phone,
    adminId: row.admin_id,
    adminName: `${row.admin_first_name || ''} ${row.admin_last_name || ''}`.trim() || 'Admin',
    adminEmail: row.admin_email
  };
}

module.exports = router;