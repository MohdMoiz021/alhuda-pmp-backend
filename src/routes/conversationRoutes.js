const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../../src/utils/logger');
const { verifyToken, extractToken } = require('../../src/utils/auth');
// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
  connectionTimeoutMillis: 2000, // How long to wait for a connection
});


// File upload configuration
const uploadDir = 'uploads/conversations';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Authentication middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = extractToken(req.header('Authorization'));
    
    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: ERROR_MESSAGES.ACCESS_DENIED,
        error: 'No token provided'
      });
    }

    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_TOKEN,
        error: 'Invalid or expired token'
      });
    }

    // Attach user to request
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Authentication error', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: ERROR_MESSAGES.ACCESS_DENIED,
      error: error.message
    });
  }
};

// ====================
// CONVERSATION ROUTES
// ====================

// 1. Create new conversation
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { case_id, title, participant_ids = [], initial_message, priority = 'medium' } = req.body;
        const userId = req.user.id;

        if (!case_id || !title) {
            return res.status(400).json({
                success: false,
                message: 'Case ID and title are required'
            });
        }

        // Check if user has access to the case
        const caseAccess = await pool.query(
            `SELECT id FROM case_updated WHERE id = $1`,
            [case_id]
        );

        if (caseAccess.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Create conversation
        const conversation = await pool.query(
            `INSERT INTO conversations (case_id, title, created_by, priority, status)
             VALUES ($1, $2, $3, $4, 'active') 
             RETURNING id, case_id, title, status, priority, created_by, created_at`,
            [case_id, title, userId, priority]
        );

        const conversationId = conversation.rows[0].id;

        // Add creator as participant
        await pool.query(
            `INSERT INTO conversation_participants (conversation_id, user_id, user_role)
             VALUES ($1, $2, $3)`,
            [conversationId, userId, req.user.role || 'user']
        );

        // Add other participants
        if (participant_ids.length > 0) {
            for (const participantId of participant_ids) {
                await pool.query(
                    `INSERT INTO conversation_participants (conversation_id, user_id, user_role)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                    [conversationId, participantId, 'user']
                );
            }
        }

        // Add initial message
        if (initial_message) {
            await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, content, message_type)
                 VALUES ($1, $2, $3, 'text')`,
                [conversationId, userId, initial_message]
            );

            await pool.query(
                'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1',
                [conversationId]
            );
        }

        // Get conversation with details
        const fullConversation = await pool.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $2
                     AND NOT EXISTS (
                         SELECT 1 FROM message_read_receipts mr 
                         WHERE mr.message_id = m.id AND mr.user_id = $2
                     )) as unread_count
             FROM conversations c
             WHERE c.id = $1`,
            [conversationId, userId]
        );

        res.status(201).json({
            success: true,
            data: fullConversation.rows[0]
        });

    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create conversation'
        });
    }
});

// 2. Get all conversations for a case
router.get('/case/:caseId', authMiddleware, async (req, res) => {
    try {
        const { caseId } = req.params;
        const userId = req.user.id;

        const conversations = await pool.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $2
                     AND NOT EXISTS (
                         SELECT 1 FROM message_read_receipts mr 
                         WHERE mr.message_id = m.id AND mr.user_id = $2
                     )) as unread_count,
                    (SELECT content FROM messages 
                     WHERE conversation_id = c.id 
                     ORDER BY created_at DESC LIMIT 1) as last_message,
                    (SELECT created_at FROM messages 
                     WHERE conversation_id = c.id 
                     ORDER BY created_at DESC LIMIT 1) as last_message_time
             FROM conversations c
             LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
             WHERE c.case_id = $1 AND cp.user_id = $2
             GROUP BY c.id
             ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
            [caseId, userId]
        );

        res.json({
            success: true,
            data: conversations.rows
        });

    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch conversations'
        });
    }
});

// 3. Get conversation details
router.get('/:conversationId', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // Check if user is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You are not a participant of this conversation'
            });
        }

        const conversation = await pool.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $2
                     AND NOT EXISTS (
                         SELECT 1 FROM message_read_receipts mr 
                         WHERE mr.message_id = m.id AND mr.user_id = $2
                     )) as unread_count
             FROM conversations c
             WHERE c.id = $1`,
            [conversationId, userId]
        );

        if (conversation.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        res.json({
            success: true,
            data: conversation.rows[0]
        });

    } catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch conversation'
        });
    }
});

// 4. Update conversation status
router.patch('/:conversationId/status', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        // Validate status
        const validStatuses = ['active', 'resolved', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        // Check if user is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Update status
        const result = await pool.query(
            `UPDATE conversations 
             SET status = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 
             RETURNING id, status`,
            [status, conversationId]
        );

        // Add system message
        await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, content, message_type)
             VALUES ($1, $2, $3, 'system')`,
            [conversationId, userId, `Conversation marked as ${status}`]
        );

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status'
        });
    }
});

// 5. Update conversation priority
router.patch('/:conversationId/priority', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { priority } = req.body;
        const userId = req.user.id;

        // Validate priority
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid priority'
            });
        }

        // Check if user is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Update priority
        const result = await pool.query(
            `UPDATE conversations 
             SET priority = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 
             RETURNING id, priority`,
            [priority, conversationId]
        );

        // Add system message
        await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, content, message_type)
             VALUES ($1, $2, $3, 'system')`,
            [conversationId, userId, `Priority changed to ${priority}`]
        );

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error updating priority:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update priority'
        });
    }
});

// 6. Add participant to conversation
router.post('/:conversationId/participants', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { user_id } = req.body;
        const userId = req.user.id;

        // Check if requester is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Add participant
        await pool.query(
            `INSERT INTO conversation_participants (conversation_id, user_id, user_role)
             VALUES ($1, $2, $3)
             ON CONFLICT (conversation_id, user_id) DO NOTHING`,
            [conversationId, user_id, 'user']
        );

        // Add system message
        await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, content, message_type)
             VALUES ($1, $2, $3, 'system')`,
            [conversationId, userId, 'Added new participant to conversation']
        );

        res.json({
            success: true,
            message: 'Participant added successfully'
        });

    } catch (error) {
        console.error('Error adding participant:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add participant'
        });
    }
});

// 7. Get conversation participants
router.get('/:conversationId/participants', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // Check if user is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const participants = await pool.query(
            `SELECT cp.user_id, cp.user_role, cp.joined_at, cp.last_seen_at,
                    name, u.email, u.avatar_url
             FROM conversation_participants cp
             LEFT JOIN users u ON cp.user_id = u.id
             WHERE cp.conversation_id = $1
             ORDER BY name`,
            [conversationId]
        );

        res.json({
            success: true,
            data: participants.rows
        });

    } catch (error) {
        console.error('Error fetching participants:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch participants'
        });
    }
});

// ====================
// MESSAGE ROUTES
// ====================

// 8. Get messages for a conversation
router.get('/:conversationId/messages', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;
        const { limit = 50 } = req.query;

        // Check access
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const messages = await pool.query(
            `SELECT m.*,
                   json_build_object(
                       'id', u.id,
                       'name', u.first_name,
                       'email', u.email,
                       'role', u.role
                   ) as sender
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at DESC
            LIMIT $2`,
            [conversationId, limit]
        );

        // Mark messages as read for this user
        await pool.query(
            `INSERT INTO message_read_receipts (message_id, user_id)
             SELECT m.id, $2
             FROM messages m
             WHERE m.conversation_id = $1 AND m.sender_id != $2
             AND NOT EXISTS (
                 SELECT 1 FROM message_read_receipts mr 
                 WHERE mr.message_id = m.id AND mr.user_id = $2
             )
             ON CONFLICT (message_id, user_id) DO NOTHING`,
            [conversationId, userId]
        );

        // Update last seen
        await pool.query(
            `UPDATE conversation_participants 
             SET last_seen_at = CURRENT_TIMESTAMP 
             WHERE conversation_id = $1 AND user_id = $2`,
            [conversationId, userId]
        );

        res.json({
            success: true,
            data: messages.rows.reverse() // Reverse to get chronological order
        });

    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch messages'
        });
    }
});

// 9. Send new message (with file upload)
router.post('/:conversationId/messages', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { content, message_type = 'text' } = req.body;
        const userId = req.user.id;
        
        let fileData = null;
        if (req.file) {
            fileData = {
                url: `/uploads/conversations/${req.file.filename}`,
                originalName: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype
            };
        }

        // Check access
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Create message
        const message = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, content, message_type, 
                                  file_url, file_name, file_size, file_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                conversationId,
                userId,
                content || '',
                message_type,
                fileData?.url || null,
                fileData?.originalName || null,
                fileData?.size || null,
                fileData?.type || null
            ]
        );

        // Update conversation last_message_at
        await pool.query(
            `UPDATE conversations 
             SET last_message_at = CURRENT_TIMESTAMP, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [conversationId]
        );

        // Get message with sender info
        const fullMessage = await pool.query(
            `SELECT m.*,
                   json_build_object(
                       'id', u.id,
                       'name', u.first_name,
                       'email', u.email,
                       'role', u.role
                   ) as sender
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1`,
            [message.rows[0].id]
        );

        res.status(201).json({
            success: true,
            data: fullMessage.rows[0]
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message'
        });
    }
});

// 10. Mark message as read
router.post('/:conversationId/messages/:messageId/read', authMiddleware, async (req, res) => {
    try {
        const { conversationId, messageId } = req.params;
        const userId = req.user.id;

        // Check if user is participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        await pool.query(
            `INSERT INTO message_read_receipts (message_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (message_id, user_id) DO NOTHING`,
            [messageId, userId]
        );

        // Update last seen
        await pool.query(
            `UPDATE conversation_participants 
             SET last_seen_at = CURRENT_TIMESTAMP 
             WHERE conversation_id = $1 AND user_id = $2`,
            [conversationId, userId]
        );

        res.json({
            success: true,
            message: 'Message marked as read'
        });

    } catch (error) {
        console.error('Error marking message as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark message as read'
        });
    }
});

// 11. Delete a message
router.delete('/:conversationId/messages/:messageId', authMiddleware, async (req, res) => {
    try {
        const { conversationId, messageId } = req.params;
        const userId = req.user.id;

        // Check if user is the sender
        const message = await pool.query(
            'SELECT * FROM messages WHERE id = $1 AND conversation_id = $2',
            [messageId, conversationId]
        );

        if (message.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        if (message.rows[0].sender_id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own messages'
            });
        }

        // Soft delete (update content)
        await pool.query(
            `UPDATE messages 
             SET content = '[Message deleted]', 
                 file_url = NULL, 
                 file_name = NULL,
                 is_deleted = TRUE
             WHERE id = $1`,
            [messageId]
        );

        res.json({
            success: true,
            message: 'Message deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete message'
        });
    }
});

// ====================
// USER-SPECIFIC ROUTES
// ====================

// 12. Get user's unread message count
router.get('/user/unread/count', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await pool.query(
            `SELECT COUNT(*) as unread_count
             FROM messages m
             JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
             WHERE cp.user_id = $1
             AND m.sender_id != $1
             AND NOT EXISTS (
                 SELECT 1 FROM message_read_receipts mr 
                 WHERE mr.message_id = m.id AND mr.user_id = $1
             )`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                unread_count: parseInt(result.rows[0].unread_count)
            }
        });

    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get unread count'
        });
    }
});

// 13. Get user's recent conversations
router.get('/user/recent', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 10 } = req.query;

        const conversations = await pool.query(
            `SELECT DISTINCT ON (c.id) c.*,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $1
                     AND NOT EXISTS (
                         SELECT 1 FROM message_read_receipts mr 
                         WHERE mr.message_id = m.id AND mr.user_id = $1
                     )) as unread_count,
                    (SELECT content FROM messages 
                     WHERE conversation_id = c.id 
                     ORDER BY created_at DESC LIMIT 1) as last_message
             FROM conversations c
             JOIN conversation_participants cp ON c.id = cp.conversation_id
             WHERE cp.user_id = $1
             ORDER BY c.id, COALESCE(c.last_message_at, c.created_at) DESC
             LIMIT $2`,
            [userId, limit]
        );

        res.json({
            success: true,
            data: conversations.rows
        });

    } catch (error) {
        console.error('Error fetching recent conversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent conversations'
        });
    }
});

// 14. Search conversations
router.get('/search/conversations', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }

        const conversations = await pool.query(
            `SELECT DISTINCT c.*
             FROM conversations c
             JOIN conversation_participants cp ON c.id = cp.conversation_id
             WHERE cp.user_id = $1
             AND (c.title ILIKE $2 OR EXISTS(
                 SELECT 1 FROM messages m 
                 WHERE m.conversation_id = c.id 
                 AND m.content ILIKE $2
             ))
             ORDER BY c.last_message_at DESC
             LIMIT 20`,
            [userId, `%${q}%`]
        );

        res.json({
            success: true,
            data: conversations.rows
        });

    } catch (error) {
        console.error('Error searching conversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search conversations'
        });
    }
});

// ====================
// ADMIN ROUTES
// ====================

// 15. Get all conversations (admin only)
router.get('/admin/all', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const conversations = await pool.query(
            `SELECT c.*,
                   json_build_object(
                       'id', u.id,
                       'name', name,
                       'email', u.email
                   ) as created_by_user
            FROM conversations c
            LEFT JOIN users u ON c.created_by = u.id
            ORDER BY c.created_at DESC
            LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        // Get total count
        const countResult = await pool.query('SELECT COUNT(*) FROM conversations');

        res.json({
            success: true,
            data: conversations.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult.rows[0].count / limit)
            }
        });

    } catch (error) {
        console.error('Error fetching all conversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch conversations'
        });
    }
});

// 16. Get conversation statistics
router.get('/admin/statistics', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM conversations WHERE status = 'active') as active_conversations,
                (SELECT COUNT(*) FROM conversations WHERE status = 'resolved') as resolved_conversations,
                (SELECT COUNT(*) FROM conversations WHERE status = 'archived') as archived_conversations,
                (SELECT COUNT(*) FROM messages WHERE DATE(created_at) = CURRENT_DATE) as messages_today,
                (SELECT COUNT(*) FROM users) as total_users
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });

    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics'
        });
    }
});

// 17. Export conversation data
router.get('/:conversationId/export', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;

        // Check if user is admin or participant
        const isParticipant = await pool.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, req.user.id]
        );

        if (isParticipant.rows.length === 0 && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get conversation data
        const conversation = await pool.query(
            `SELECT c.*,
                   json_build_object(
                       'id', u.id,
                       'name', name,
                       'email', u.email
                   ) as created_by_user
            FROM conversations c
            LEFT JOIN users u ON c.created_by = u.id
            WHERE c.id = $1`,
            [conversationId]
        );

        // Get messages
        const messages = await pool.query(
            `SELECT m.*, name as sender_name
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             WHERE m.conversation_id = $1
             ORDER BY m.created_at`,
            [conversationId]
        );

        // Get participants
        const participants = await pool.query(
            `SELECT name, u.email, u.role, cp.joined_at
             FROM conversation_participants cp
             LEFT JOIN users u ON cp.user_id = u.id
             WHERE cp.conversation_id = $1`,
            [conversationId]
        );

        const exportData = {
            conversation: conversation.rows[0],
            messages: messages.rows,
            participants: participants.rows,
            export_date: new Date().toISOString(),
            exported_by: req.user.id
        };

        res.json({
            success: true,
            data: exportData
        });

    } catch (error) {
        console.error('Error exporting conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export conversation'
        });
    }
});

module.exports = router;