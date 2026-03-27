// services/twilioConversationService.js
const twilio = require('twilio');

class TwilioConversationService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.conversationsClient = this.client.conversations;
    this.whatsappFrom = `whatsapp:${process.env.WHATSAPP_FROM_NUMBER}`;
  }

  // Get or create a conversation for a specific case
  async getOrCreateCaseConversation(caseId, userId, userName, userPhone, adminId, adminName) {
    // Create a unique conversation ID for this case
    const conversationUniqueName = `case_${caseId}_${userId}`;
    
    try {
      // Try to fetch existing conversation
      let conversation = await this.conversationsClient.conversations(conversationUniqueName).fetch()
        .catch(() => null);
      
      if (!conversation) {
        // Create new conversation
        conversation = await this.conversationsClient.conversations.create({
          uniqueName: conversationUniqueName,
          friendlyName: `Case #${caseId} - ${userName}`,
          attributes: JSON.stringify({
            caseId: caseId,
            userId: userId,
            adminId: adminId,
            userPhone: userPhone,
            createdAt: new Date().toISOString()
          })
        });
        
        // Add participants
        // Add admin as participant (for web chat)
        await this.conversationsClient.conversations(conversation.sid)
          .participants.create({
            identity: `admin_${adminId}`,
            attributes: JSON.stringify({
              role: 'admin',
              name: adminName,
              type: 'web'
            })
          });
        
        // Add user as participant (for web chat)
        await this.conversationsClient.conversations(conversation.sid)
          .participants.create({
            identity: `user_${userId}`,
            attributes: JSON.stringify({
              role: 'user',
              name: userName,
              type: 'web'
            })
          });
        
        // Add WhatsApp participant (customer's WhatsApp)
        await this.conversationsClient.conversations(conversation.sid)
          .participants.create({
            messagingBinding: {
              address: `whatsapp:${userPhone}`,
              proxyAddress: this.whatsappFrom
            },
            attributes: JSON.stringify({
              role: 'customer',
              name: userName,
              type: 'whatsapp'
            })
          });
        
        console.log(`✅ Created conversation for case ${caseId}: ${conversation.sid}`);
      }
      
      return conversation;
      
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }

  // Send message to conversation (from admin or system)
  async sendMessage(conversationSid, message, sender) {
    try {
      const conversation = this.conversationsClient.conversations(conversationSid);
      
      // Send message to conversation
      const messageData = await conversation.messages.create({
        author: sender.name,
        body: message,
        attributes: JSON.stringify({
          senderId: sender.id,
          senderRole: sender.role,
          senderName: sender.name,
          timestamp: new Date().toISOString()
        })
      });
      
      return messageData;
      
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  // Send WhatsApp message (outbound)
  async sendWhatsAppMessage(userPhone, message, caseId) {
    try {
      const result = await this.twilioClient.messages.create({
        from: this.whatsappFrom,
        to: `whatsapp:${userPhone}`,
        body: message
      });
      
      // Also add to conversation
      const conversationUniqueName = `case_${caseId}`;
      try {
        const conversation = await this.conversationsClient.conversations(conversationUniqueName).fetch();
        await this.sendMessage(conversation.sid, message, {
          id: 'system',
          name: 'Al Huda Support',
          role: 'system'
        });
      } catch (err) {
        // Conversation might not exist yet
        console.log('No conversation found to add message');
      }
      
      return result;
      
    } catch (error) {
      console.error('Error sending WhatsApp:', error);
      throw error;
    }
  }

  // Get conversation messages
  async getConversationMessages(conversationSid, limit = 100) {
    try {
      const messages = await this.conversationsClient.conversations(conversationSid)
        .messages.list({ limit });
      
      return messages.reverse(); // Chronological order
      
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
  }

  // Get all conversations for a user
  async getUserConversations(userId) {
    try {
      // Fetch all conversations where user is participant
      const conversations = await this.conversationsClient.conversations.list();
      
      // Filter conversations where user is participant
      const userConversations = [];
      
      for (const conv of conversations) {
        try {
          const participants = await this.conversationsClient.conversations(conv.sid)
            .participants.list();
          
          const isParticipant = participants.some(p => 
            p.identity === `user_${userId}` || 
            (p.messagingBinding?.address === `whatsapp:${userId}`)
          );
          
          if (isParticipant) {
            const attributes = JSON.parse(conv.attributes || '{}');
            userConversations.push({
              sid: conv.sid,
              uniqueName: conv.uniqueName,
              friendlyName: conv.friendlyName,
              caseId: attributes.caseId,
              lastMessage: await this.getLastMessage(conv.sid),
              updatedAt: conv.dateUpdated
            });
          }
        } catch (err) {
          console.error('Error checking participants:', err);
        }
      }
      
      return userConversations;
      
    } catch (error) {
      console.error('Error fetching conversations:', error);
      return [];
    }
  }

  // Get last message in conversation
  async getLastMessage(conversationSid) {
    try {
      const messages = await this.conversationsClient.conversations(conversationSid)
        .messages.list({ limit: 1 });
      
      return messages[0] || null;
      
    } catch (error) {
      return null;
    }
  }

  // Generate chat token for client-side (web chat)
  async generateChatToken(identity, ttl = 3600) {
    const AccessToken = twilio.jwt.AccessToken;
    const ChatGrant = AccessToken.ChatGrant;
    
    const chatGrant = new ChatGrant({
      serviceSid: process.env.TWILIO_CONVERSATIONS_SERVICE_SID
    });
    
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { ttl: ttl }
    );
    
    token.identity = identity;
    token.addGrant(chatGrant);
    
    return token.toJwt();
  }
}

module.exports = new TwilioConversationService();