const db = require('../../db');
const { uploadFile } = require('../utils/fileUpload');

exports.createConversation = async (req, res) => {
    try {
        const { case_id, title, participant_ids, initial_message, priority } = req.body;
        const userId = req.user.id;

        // Check if user has access to the case
        const caseAccess = await db.query(
            `SELECT * FROM cases WHERE id = $1 AND (
                created_by = $2 
                OR EXISTS (SELECT 1 FROM json_array_elements_text(admin_ids::json) AS admin WHERE admin::integer = $2)
                OR EXISTS (SELECT 1 FROM json_array_elements_text(sub_consultant_ids::json) AS sub WHERE sub::integer = $2)
            )`,
            [case_id, userId]
        );

        if (caseAccess.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You do not have access to this case'
            });
        }

        // Create conversation
        const conversation = await db.query(
            `INSERT INTO conversations (case_id, title, created_by, priority, status)
             VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
            [case_id, title, userId, priority || 'medium']
        );

        const conversationId = conversation.rows[0].id;

        // Add creator as participant
        await db.query(
            `INSERT INTO conversation_participants (conversation_id, user_id, user_role)
             VALUES ($1, $2, $3)`,
            [conversationId, userId, req.user.role]
        );

        // Add other participants
        if (participant_ids && participant_ids.length > 0) {
            const participantPromises = participant_ids.map(async (participantId) => {
                const user = await db.query(
                    'SELECT id, role FROM users WHERE id = $1',
                    [participantId]
                );
                
                if (user.rows.length > 0) {
                    await db.query(
                        `INSERT INTO conversation_participants (conversation_id, user_id, user_role)
                         VALUES ($1, $2, $3)
                         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                        [conversationId, participantId, user.rows[0].role]
                    );
                }
            });
            await Promise.all(participantPromises);
        }

        // Add initial message if provided
        if (initial_message) {
            await db.query(
                `INSERT INTO messages (conversation_id, sender_id, content, message_type)
                 VALUES ($1, $2, $3, 'text')`,
                [conversationId, userId, initial_message]
            );

            // Update last_message_at
            await db.query(
                'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1',
                [conversationId]
            );
        }

        // Get full conversation details
        const fullConversation = await db.query(
            `SELECT c.*, 
                    json_build_object(
                        'id', u.id,
                        'name', u.full_name,
                        'email', u.email,
                        'role', u.role
                    ) as created_by_user,
                    COALESCE(
                        json_agg(DISTINCT json_build_object(
                            'id', cp.user_id,
                            'name', u2.full_name,
                            'email', u2.email,
                            'role', cp.user_role,
                            'joined_at', cp.joined_at,
                            'last_seen_at', cp.last_seen_at
                        )) FILTER (WHERE cp.user_id IS NOT NULL),
                        '[]'::json
                    ) as participants
             FROM conversations c
             LEFT JOIN users u ON c.created_by = u.id
             LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
             LEFT JOIN users u2 ON cp.user_id = u2.id
             WHERE c.id = $1
             GROUP BY c.id, u.id`,
            [conversationId]
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
};

exports.getCaseConversations = async (req, res) => {
    try {
        const { caseId } = req.params;
        const userId = req.user.id;

        // Check access to case
        const caseAccess = await db.query(
            `SELECT id FROM cases WHERE id = $1 AND (
                created_by = $2 
                OR $2 = ANY(SELECT json_array_elements_text(admin_ids::json)::integer)
                OR $2 = ANY(SELECT json_array_elements_text(sub_consultant_ids::json)::integer)
            )`,
            [caseId, userId]
        );

        if (caseAccess.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get conversations with unread count
        const conversations = await db.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $2
                     AND m.id NOT IN (
                         SELECT message_id FROM message_read_receipts 
                         WHERE user_id = $2
                     )) as unread_count,
                    (SELECT content FROM messages 
                     WHERE conversation_id = c.id 
                     ORDER BY created_at DESC LIMIT 1) as last_message,
                    (SELECT created_at FROM messages 
                     WHERE conversation_id = c.id 
                     ORDER BY created_at DESC LIMIT 1) as last_message_time,
                    COALESCE(
                        json_agg(DISTINCT json_build_object(
                            'id', u.id,
                            'name', u.full_name,
                            'email', u.email
                        )) FILTER (WHERE u.id IS NOT NULL),
                        '[]'::json
                    ) as participants
             FROM conversations c
             LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
             LEFT JOIN users u ON cp.user_id = u.id
             WHERE c.case_id = $1
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
};

exports.getConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // Check if user is participant
        const isParticipant = await db.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You are not a participant of this conversation'
            });
        }

        // Get conversation details
        const conversation = await db.query(
            `SELECT c.*,
                    json_build_object(
                        'id', u.id,
                        'name', u.full_name,
                        'email', u.email,
                        'role', u.role
                    ) as created_by_user,
                    (SELECT COUNT(*) FROM messages m 
                     WHERE m.conversation_id = c.id 
                     AND m.sender_id != $2
                     AND m.id NOT IN (
                         SELECT message_id FROM message_read_receipts 
                         WHERE user_id = $2
                     )) as unread_count,
                    COALESCE(
                        json_agg(DISTINCT json_build_object(
                            'id', cp.user_id,
                            'name', u2.full_name,
                            'email', u2.email,
                            'role', cp.user_role,
                            'last_seen_at', cp.last_seen_at,
                            'is_online', u2.last_active_at > NOW() - INTERVAL '5 minutes'
                        )) FILTER (WHERE cp.user_id IS NOT NULL),
                        '[]'::json
                    ) as participants
             FROM conversations c
             LEFT JOIN users u ON c.created_by = u.id
             LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
             LEFT JOIN users u2 ON cp.user_id = u2.id
             WHERE c.id = $1
             GROUP BY c.id, u.id`,
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
};

exports.getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { before, limit = 50 } = req.query;
        const userId = req.user.id;

        // Check access
        const isParticipant = await db.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let query = `
            SELECT m.*,
                   json_build_object(
                       'id', u.id,
                       'name', u.full_name,
                       'email', u.email,
                       'role', u.role,
                       'avatar', u.avatar_url
                   ) as sender,
                   EXISTS(SELECT 1 FROM message_read_receipts 
                          WHERE message_id = m.id AND user_id = $2) as is_read_by_me
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
        `;

        const params = [conversationId, userId];

        if (before) {
            query += ` AND m.id < $3`;
            params.push(parseInt(before));
        }

        query += ` ORDER BY m.id DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));

        const messages = await db.query(query, params);

        // Mark messages as read for this user
        if (messages.rows.length > 0) {
            const messageIds = messages.rows.map(m => m.id);
            await db.query(
                `INSERT INTO message_read_receipts (message_id, user_id)
                 SELECT unnest($1::integer[]), $2
                 ON CONFLICT (message_id, user_id) DO NOTHING`,
                [messageIds, userId]
            );

            // Update last seen
            await db.query(
                `UPDATE conversation_participants 
                 SET last_seen_at = CURRENT_TIMESTAMP 
                 WHERE conversation_id = $1 AND user_id = $2`,
                [conversationId, userId]
            );
        }

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
};

exports.sendMessage = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { content, message_type = 'text' } = req.body;
        const userId = req.user.id;
        let fileData = null;

        // Check access
        const isParticipant = await db.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, userId]
        );

        if (isParticipant.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Handle file upload
        if (req.files && req.files.file) {
            const file = req.files.file;
            fileData = await uploadFile(file, 'conversations');
        }

        // Create message
        const message = await db.query(
            `INSERT INTO messages (conversation_id, sender_id, content, message_type, file_url, file_name, file_size, file_type)
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
        await db.query(
            `UPDATE conversations 
             SET last_message_at = CURRENT_TIMESTAMP, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [conversationId]
        );

        // Get message with sender info
        const fullMessage = await db.query(
            `SELECT m.*,
                   json_build_object(
                       'id', u.id,
                       'name', u.full_name,
                       'email', u.email,
                       'role', u.role,
                       'avatar', u.avatar_url
                   ) as sender
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1`,
            [message.rows[0].id]
        );

        // Emit socket event
        if (req.io) {
            req.io.to(`conversation_${conversationId}`).emit('new_message', {
                message: fullMessage.rows[0],
                conversation_id: conversationId
            });
        }

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
};