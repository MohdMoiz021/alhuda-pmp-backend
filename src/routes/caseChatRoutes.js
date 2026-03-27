// routes/caseChatRoutes.js
const express = require('express');
const router = express.Router();
const twilioConversationService = require('../../services/twilioConversationService');
const { emailTemplates } = require('../../services/emailService');

// Send WhatsApp message from admin to user for a specific case
router.post('/cases/:caseId/send-whatsapp', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { message, userId, userName, userPhone, adminId, adminName } = req.body;
    
    // Get or create conversation
    const conversation = await twilioConversationService.getOrCreateCaseConversation(
      caseId, userId, userName, userPhone, adminId, adminName
    );
    
    // Send WhatsApp message
    const result = await twilioConversationService.sendWhatsAppMessage(
      userPhone, message, caseId
    );
    
    // Add message to conversation
    await twilioConversationService.sendMessage(conversation.sid, message, {
      id: adminId,
      name: adminName,
      role: 'admin'
    });
    
    res.json({
      success: true,
      messageSid: result.sid,
      conversationSid: conversation.sid
    });
    
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get conversation history for a case
router.get('/cases/:caseId/conversation', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { userId } = req.query;
    
    const conversationUniqueName = `case_${caseId}_${userId}`;
    
    try {
      const conversation = await twilioConversationService.conversationsClient
        .conversations(conversationUniqueName).fetch();
      
      const messages = await twilioConversationService.getConversationMessages(conversation.sid);
      
      res.json({
        success: true,
        conversation: conversation,
        messages: messages
      });
      
    } catch (error) {
      // No conversation exists yet
      res.json({
        success: true,
        conversation: null,
        messages: []
      });
    }
    
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all case conversations for admin
router.get('/admin/conversations', async (req, res) => {
  try {
    const conversations = await twilioConversationService.conversationsClient
      .conversations.list();
    
    // Parse and filter conversations
    const caseConversations = [];
    
    for (const conv of conversations) {
      if (conv.uniqueName?.startsWith('case_')) {
        const attributes = JSON.parse(conv.attributes || '{}');
        const lastMessage = await twilioConversationService.getLastMessage(conv.sid);
        
        caseConversations.push({
          sid: conv.sid,
          uniqueName: conv.uniqueName,
          caseId: attributes.caseId,
          friendlyName: conv.friendlyName,
          lastMessage: lastMessage?.body || null,
          lastMessageTime: lastMessage?.dateCreated,
          updatedAt: conv.dateUpdated,
          status: conv.state
        });
      }
    }
    
    // Sort by last message time
    caseConversations.sort((a, b) => 
      new Date(b.lastMessageTime || b.updatedAt) - new Date(a.lastMessageTime || a.updatedAt)
    );
    
    res.json({ success: true, conversations: caseConversations });
    
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;