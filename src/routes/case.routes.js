


const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../../db');
const { upload, uploadToS3 } = require('../../middleware/upload.middleware');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { authenticate } = require('../../middleware/auth');
const { emailTemplates } = require('../../services/emailService');
// Configure multer to accept ANY field name
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname || ''));
  }
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

async function generatePresignedUrl(s3Key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key
  });
  return await getSignedUrl(s3Client, command, { expiresIn });
}



router.patch('/:caseId/status', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { 
      status, 
      remarks = '', 
      updated_by = null,
      total_deal_value,
      profit_margin,
      total_profit,
      commission,
      commission_percentage 
    } = req.body;

    // Validate status
    if (!['pending', 'approved', 'rejected', 'clarification_needed', 'in_review'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // For approval, validate financial fields
    if (status === 'approved') {
      if (!total_deal_value || !profit_margin || !commission || !commission_percentage || !total_profit) {
        return res.status(400).json({
          success: false,
          message: 'Total deal value, profit margin, and commission are required for approval'
        });
      }
    }

    // Check if case exists and get user details
    const caseCheck = await db.query(
      `SELECT c.*, u.email, u.first_name, u.last_name, u.role 
       FROM case_updated c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [caseId]
    );

    if (!caseCheck.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    const existingCase = caseCheck.rows[0];
    const oldStatus = existingCase.status;

    // Build dynamic update query for case_updated
    let updateFields = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    let values = [status];
    let paramIndex = 2;

    // Add financial fields only if provided (for approval)
    if (total_deal_value !== undefined) {
      updateFields.push(`total_deal_value = $${paramIndex}`);
      values.push(total_deal_value);
      paramIndex++;
    }
    if (total_profit !== undefined) {
      updateFields.push(`total_profit = $${paramIndex}`);
      values.push(total_profit);
      paramIndex++;
    }
    if (profit_margin !== undefined) {
      updateFields.push(`profit_margin = $${paramIndex}`);
      values.push(profit_margin);
      paramIndex++;
    }
    if (commission_percentage !== undefined) {
      updateFields.push(`commission_percentage = $${paramIndex}`);
      values.push(commission_percentage);
      paramIndex++;
    }
    if (commission !== undefined) {
      updateFields.push(`commission = $${paramIndex}`);
      values.push(commission);
      paramIndex++;
    }

    values.push(caseId);

    // 1️⃣ Update the main case status and financial details
    const updatedCase = await db.query(
      `
      UPDATE case_updated
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *;
      `,
      values
    );

    // 2️⃣ Insert or update remarks in case_status table
    const statusResult = await db.query(
      `
      INSERT INTO case_status (case_id, status, remarks, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (case_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        remarks = EXCLUDED.remarks,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
      `,
      [caseId, status, remarks, updated_by]
    );

    // 3️⃣ 📧 SEND EMAIL NOTIFICATIONS BASED ON STATUS
    try {
      const { emailTemplates } = require('../../services/emailService');
      
      // Get admin emails for notifications
      const adminEmails = await db.query(
        `SELECT email FROM users WHERE role IN ('admin_c', 'admin_a') AND is_active = true`
      );
      const adminEmailList = adminEmails.rows.map(admin => admin.email);
      
      // Case data for emails
      const caseData = {
        caseId: caseId,
        caseTitle: existingCase.title || `Case #${caseId}`,
        clientName: `${existingCase.first_name || ''} ${existingCase.last_name || ''}`.trim() || 'Client',
        clientEmail: existingCase.email,
        status: status,
        oldStatus: oldStatus,
        remarks: remarks,
        updatedBy: updated_by,
        updatedAt: new Date(),
        financialDetails: status === 'approved' ? {
          total_deal_value: total_deal_value || existingCase.total_deal_value,
          profit_margin: profit_margin || existingCase.profit_margin,
          total_profit: total_profit || existingCase.total_profit,
          commission: commission || existingCase.commission,
          commission_percentage: commission_percentage || existingCase.commission_percentage
        } : null
      };

      // Send email based on status
      switch (status) {
        case 'approved':
          // Send approval email to client
          await emailTemplates.caseApproved(caseData);
          console.log(`✅ Case approval email sent to client: ${existingCase.email}`);
          
          // Send notification to admins
          if (adminEmailList.length > 0) {
            await emailTemplates.caseApprovedAdmin(caseData, adminEmailList);
            console.log(`✅ Case approval notification sent to admins`);
          }
          break;
          
        case 'rejected':
          // Send rejection email to client with reason
          await emailTemplates.caseRejected(caseData);
          console.log(`❌ Case rejection email sent to client: ${existingCase.email}`);
          
          // Send notification to admins
          if (adminEmailList.length > 0) {
            await emailTemplates.caseRejectedAdmin(caseData, adminEmailList);
            console.log(`❌ Case rejection notification sent to admins`);
          }
          break;
          
        case 'clarification_needed':
          // Send clarification request email to client
          await emailTemplates.caseClarificationNeeded(caseData);
          console.log(`📝 Clarification request email sent to client: ${existingCase.email}`);
          
          // Send notification to admins
          if (adminEmailList.length > 0) {
            await emailTemplates.caseClarificationNeededAdmin(caseData, adminEmailList);
            console.log(`📝 Clarification request notification sent to admins`);
          }
          break;
          
        case 'in_review':
          // Send in-review notification to client
          await emailTemplates.caseInReview(caseData);
          console.log(`🔄 Case in-review email sent to client: ${existingCase.email}`);
          
          // Send notification to admins
          if (adminEmailList.length > 0) {
            await emailTemplates.caseInReviewAdmin(caseData, adminEmailList);
            console.log(`🔄 Case in-review notification sent to admins`);
          }
          break;
          
        case 'pending':
          // Send pending notification
          await emailTemplates.casePending(caseData);
          console.log(`⏳ Case pending email sent to client: ${existingCase.email}`);
          break;
          
        default:
          console.log(`No email template for status: ${status}`);
      }
      
    } catch (emailError) {
      console.error('⚠️ Failed to send status update email:', emailError.message);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: `Case ${status} successfully`,
      data: {
        case: updatedCase.rows[0],
        case_status: statusResult.rows[0]
      }
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update case status',
      error: error.message
    });
  }
});

/**
 * GET /api/cases/user/:userId/summary
 * Get summary statistics for a user's cases
 */
/**
 * GET /api/cases/user/:userId
 * Get all cases and summary for a specific user
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = 50, offset = 0, search } = req.query;

    const userIdNum = parseInt(userId);
    if (isNaN(userIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // ===== SUMMARY QUERY =====
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_cases,
        COUNT(CASE WHEN cs.status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN cs.status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN cs.status IN ('pending', 'submitted') THEN 1 END) as pending,
        COUNT(CASE WHEN cs.status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN cs.status = 'under_review' THEN 1 END) as under_review,
        COUNT(CASE WHEN cu.priority = 'urgent' THEN 1 END) as urgent_cases,
        SUM(cu.total_deal_value) as total_deal_value,
        SUM(cu.commission) as total_commission,
        SUM(cu.total_profit) as total_profit,
        COALESCE(AVG(cu.commission), 0) as avg_commission
      FROM case_updated cu
      LEFT JOIN case_status cs ON cu.id = cs.case_id
      WHERE cu.user_id = $1
    `;

    const summaryResult = await db.query(summaryQuery, [userIdNum]);

    // ===== CASES LIST QUERY =====
    let listQuery = `
      SELECT 
        cu.id,
        cu.case_reference,
        cu.case_type,
        cu.case_sub_type,
        cu.priority,
        cu.total_deal_value,
        cu.commission,
        cu.total_profit,
        cu.created_at,
        cu.updated_at,
        cu.partner_name,
        cu.partner_email,
        cu.description,
        cu.additional_notes,
        COALESCE(cs.status, cu.status, 'pending') as status,
        cs.remarks,
        cs.updated_at as status_updated_at
      FROM case_updated cu
      LEFT JOIN (
        SELECT DISTINCT ON (case_id) 
          case_id,
          status,
          remarks,
          updated_at
        FROM case_status
        ORDER BY case_id, updated_at DESC
      ) cs ON cu.id = cs.case_id
      WHERE cu.user_id = $1
    `;

    const listParams = [userIdNum];
    let paramIndex = 2;

    // Add status filter if provided
    if (status) {
      listQuery += ` AND COALESCE(cs.status, cu.status) = $${paramIndex}`;
      listParams.push(status);
      paramIndex++;
    }

    // Add search functionality
    if (search) {
      listQuery += ` AND (
        cu.case_reference ILIKE $${paramIndex} OR 
        cu.partner_name ILIKE $${paramIndex} OR 
        cu.case_type ILIKE $${paramIndex}
      )`;
      listParams.push(`%${search}%`);
      paramIndex++;
    }

    // Add sorting and pagination
    listQuery += ` ORDER BY cu.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    listParams.push(parseInt(limit), parseInt(offset));

    const listResult = await db.query(listQuery, listParams);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM case_updated WHERE user_id = $1`;
    const countParams = [userIdNum];
    
    if (status) {
      countQuery = `
        SELECT COUNT(*) 
        FROM case_updated cu
        LEFT JOIN case_status cs ON cu.id = cs.case_id
        WHERE cu.user_id = $1 AND COALESCE(cs.status, cu.status) = $2
      `;
      countParams.push(status);
    }
    
    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      summary: summaryResult.rows[0] || {
        total_cases: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        in_progress: 0,
        under_review: 0,
        urgent_cases: 0,
        total_deal_value: 0,
        total_commission: 0,
        total_profit: 0,
        avg_commission: 0
      },
      cases: listResult.rows,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      },
      user: {
        id: userIdNum
      }
    });

  } catch (error) {
    console.error('Error fetching user cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user cases',
      error: error.message
    });
  }
});




router.get('/case-status-counts', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'in_review' THEN 1 END) as in_review,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'clarification_needed' THEN 1 END) as clarification_needed,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(*) as total
      FROM case_updated
    `);

    const counts = result.rows[0];
    
    res.json({
      success: true,
      timestamp: new Date(),
      data: {
        pending: parseInt(counts.pending),
        in_review: parseInt(counts.in_review),
        approved: parseInt(counts.approved),
        clarification_needed: parseInt(counts.clarification_needed),
        rejected: parseInt(counts.rejected),
        total: parseInt(counts.total)
      },
      summary: {
        total_cases: parseInt(counts.total),
        active_cases: parseInt(counts.pending) + parseInt(counts.in_review) + parseInt(counts.clarification_needed),
        completed_cases: parseInt(counts.approved),
        rejected_cases: parseInt(counts.rejected)
      }
    });

  } catch (error) {
    console.error('Error fetching status counts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch case status counts',
      error: error.message
    });
  }
});

// GET API for case statistics

        // Calculate total cases
// Simple API for your UI table - FIXED
router.get('/case-counts', async (req, res) => {
    try {
        // First, get all counts with CASE statement but don't reference alias in GROUP BY
        const result = await db.query(`
            SELECT 
                CASE 
                    WHEN case_type ILIKE '%consult%' OR case_type = 'Bank Consultancy' THEN 'Business Account Opening'
                    WHEN case_type ILIKE '%trade%' OR case_type ILIKE '%lc%' OR case_type ILIKE '%bg%' OR case_type = 'Trade Facilities' THEN 'Trade Facilities (LC, BG, Guarantees)'
                    WHEN case_type ILIKE '%project%' OR case_type = 'Project Funding' THEN 'Project Funding'
                    WHEN case_type ILIKE '%sukuk%' OR case_type = 'Sukuk Funding' THEN 'Sukuk Funding'
                    ELSE 'Other Custom Services'
                END as service_name,
                COUNT(*) as count
            FROM case_updated
            WHERE status NOT IN ('rejected', 'deleted') OR status IS NULL
            GROUP BY 
                CASE 
                    WHEN case_type ILIKE '%consult%' OR case_type = 'Bank Consultancy' THEN 'Business Account Opening'
                    WHEN case_type ILIKE '%trade%' OR case_type ILIKE '%lc%' OR case_type ILIKE '%bg%' OR case_type = 'Trade Facilities' THEN 'Trade Facilities (LC, BG, Guarantees)'
                    WHEN case_type ILIKE '%project%' OR case_type = 'Project Funding' THEN 'Project Funding'
                    WHEN case_type ILIKE '%sukuk%' OR case_type = 'Sukuk Funding' THEN 'Sukuk Funding'
                    ELSE 'Other Custom Services'
                END
        `);

        // Define the default categories in the exact order you want
        const defaultCategories = [
            'Business Account Opening',
            'Trade Facilities (LC, BG, Guarantees)',
            'Project Funding',
            'Sukuk Funding',
            'Other Custom Services'
        ];

        // Create a map of the results
        const countsMap = {};
        result.rows.forEach(row => {
            countsMap[row.service_name] = parseInt(row.count);
        });

        // Build the final array in the correct order
        const counts = defaultCategories.map(category => ({
            service_name: category,
            count: countsMap[category] || 0
        }));

        res.json({
            success: true,
            data: counts,
            total: counts.reduce((sum, item) => sum + item.count, 0),
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching case counts',
            error: error.message
        });
    }
});
    

// GET API for filtered case statistics
router.get('/api/case-stats/filtered', async (req, res) => {
    try {
        const { status, priority, case_type, date_from, date_to } = req.query;
        
        let query = `
            SELECT 
                CASE 
                    WHEN case_type = 'Bank Consultancy' OR case_type ILIKE '%consult%' THEN 'Business Account Opening'
                    WHEN case_type = 'Trade Facilities' OR case_type ILIKE '%trade%' OR case_type ILIKE '%LC%' OR case_type ILIKE '%BG%' THEN 'Trade Facilities (LC, BG, Guarantees)'
                    WHEN case_type = 'Project Funding' OR case_type ILIKE '%project%' THEN 'Project Funding'
                    WHEN case_type = 'Sukuk Funding' OR case_type ILIKE '%sukuk%' THEN 'Sukuk Funding'
                    ELSE 'Other Custom Services'
                END as service_name,
                COUNT(*) as count_value
            FROM case_updated
            WHERE 1=1
        `;
        
        const values = [];
        let paramIndex = 1;

        if (status) {
            query += ` AND status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        if (priority) {
            query += ` AND priority = $${paramIndex}`;
            values.push(priority);
            paramIndex++;
        }

        if (case_type) {
            query += ` AND case_type = $${paramIndex}`;
            values.push(case_type);
            paramIndex++;
        }

        if (date_from) {
            query += ` AND created_at >= $${paramIndex}`;
            values.push(date_from);
            paramIndex++;
        }

        if (date_to) {
            query += ` AND created_at <= $${paramIndex}`;
            values.push(date_to);
            paramIndex++;
        }

        query += ` GROUP BY service_name ORDER BY count_value DESC`;

        const stats = await db.query(query, values);

        res.json({
            success: true,
            filters: { status, priority, case_type, date_from, date_to },
            data: stats.rows
        });

    } catch (error) {
        console.error('Filter error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching filtered statistics',
            error: error.message
        });
    }
});

// GET API for specific case type details
router.get('/api/case-stats/:caseType', async (req, res) => {
    try {
        const { caseType } = req.params;
        
        const details = await db.query(`
            SELECT 
                id,
                case_reference,
                case_sub_type,
                priority,
                status,
                partner_name,
                partner_email,
                created_at,
                assigned_name,
                EXTRACT(DAY FROM NOW() - created_at) as age_in_days
            FROM case_updated
            WHERE case_type = $1 
                AND status IN ('approved', 'in_review', 'pending')
            ORDER BY 
                CASE 
                    WHEN priority = 'Urgent' THEN 1
                    WHEN priority = 'High' THEN 2
                    WHEN priority = 'Medium' THEN 3
                    WHEN priority = 'Normal' THEN 4
                    WHEN priority = 'Low' THEN 5
                    ELSE 6
                END,
                created_at DESC
        `, [caseType]);

        res.json({
            success: true,
            case_type: caseType,
            total: details.rows.length,
            cases: details.rows
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching case details',
            error: error.message
        });
    }
});




router.get('/:caseId/assignees', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;

    const query = `
      SELECT 
        c.assigned_to,
        c.assigned_name,
        c.assigned_role,
        c.assigned_at,
        u.email,
        u.first_name,
        u.last_name
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.id = $1
    `;

    const result = await db.query(query, [caseId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    const assignee = result.rows[0];
    
    res.json({
      success: true,
      assignee: assignee.assigned_to ? {
        id: assignee.assigned_to,
        name: assignee.assigned_name,
        role: assignee.assigned_role,
        email: assignee.email,
        firstName: assignee.first_name,
        lastName: assignee.last_name,
        assignedAt: assignee.assigned_at
      } : null
    });

  } catch (error) {
    console.error('Error fetching assignee:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignee',
      error: error.message
    });
  }
});

/**
 * POST /api/cases/:caseId/assign
 * Assign a case to a team member
 */


router.post('/:caseId/assign', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const { assigned_to, assigned_name, assigned_role } = req.body;
    const assigned_by = req.user.id; // From auth middleware
    const assigned_by_name = req.user.name || req.user.first_name + ' ' + req.user.last_name || 'Admin';

    // Validate input
    if (!assigned_to) {
      return res.status(400).json({
        success: false,
        message: 'assigned_to (user ID) is required'
      });
    }

    // Start transaction for data consistency
    await db.query('BEGIN');

    // First, get the case details and assigned user details before updating
    const caseDetailsQuery = `
      SELECT 
        c.id,
        c.case_reference,
        c.case_type,
        c.case_sub_type,
        c.description,
        c.priority,
        c.partner_name,
        c.partner_email,
        c.status,
        u.email as assigner_email,
        u.first_name as assigner_first_name,
        u.last_name as assigner_last_name
      FROM case_updated c
      LEFT JOIN users u ON u.id = $2
      WHERE c.id = $1
    `;
    
    const caseDetailsResult = await db.query(caseDetailsQuery, [caseId, assigned_by]);
    
    if (caseDetailsResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }
    
    const caseData = caseDetailsResult.rows[0];

    // Get assigned user details
    const assignedUserQuery = `
      SELECT id, first_name, last_name, email, role
      FROM users
      WHERE id = $1 AND is_active = true
    `;
    
    const assignedUserResult = await db.query(assignedUserQuery, [assigned_to]);
    
    if (assignedUserResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Assigned user not found or inactive'
      });
    }
    
    const assignedUser = assignedUserResult.rows[0];

    // Update the case with new assignment
    const updateQuery = `
      UPDATE case_updated 
      SET 
        assigned_to = $1,
        assigned_name = $2,
        assigned_role = $3,
        assigned_at = NOW(),
        updated_at = NOW()
      WHERE id = $4
      RETURNING 
        id,
        case_reference,
        assigned_to,
        assigned_name,
        assigned_role,
        assigned_at,
        partner_name,
        partner_email,
        status,
        case_type,
        case_sub_type,
        priority
    `;

    const updateResult = await db.query(updateQuery, [
      assigned_to, 
      assigned_name || assignedUser.first_name + ' ' + assignedUser.last_name, 
      assigned_role || assignedUser.role, 
      caseId
    ]);

    if (updateResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    const updatedCase = updateResult.rows[0];

    // Log assignment in activity log
    const logQuery = `
      INSERT INTO case_activity_log (
        case_id,
        user_id,
        action,
        details,
        created_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `;

    await db.query(logQuery, [
      caseId,
      assigned_by,
      'ASSIGNED',
      JSON.stringify({
        assigned_to,
        assigned_name: updatedCase.assigned_name,
        assigned_role: updatedCase.assigned_role,
        previous_assignee: null
      })
    ]);

    await db.query('COMMIT');

    // 📧 SEND EMAIL NOTIFICATIONS
    try {
      // 1. Send email to the assigned team member
      if (assignedUser.email) {
        await emailTemplates.caseAssignedToTeamMember({
          team_member_name: assignedUser.first_name || 'Team Member',
          team_member_email: assignedUser.email,
          case_reference: updatedCase.case_reference,
          case_type: updatedCase.case_type,
          case_sub_type: updatedCase.case_sub_type,
          description: caseData.description,
          priority: updatedCase.priority,
          partner_name: updatedCase.partner_name,
          assigned_by_name: assigned_by_name,
          assigned_date: new Date().toLocaleString(),
          case_id: updatedCase.id
        });
        console.log(`✅ Assignment email sent to team member: ${assignedUser.email}`);
      }

      // 2. Get all admin users (admin_a and admin_c) to notify them
      const adminQuery = `
        SELECT id, first_name, last_name, email, role
        FROM users
        WHERE role IN ('admin_a', 'admin_c') 
        AND is_active = true
        AND id != $1  -- Exclude the assigner if they are admin
      `;
      const adminResult = await db.query(adminQuery, [assigned_by]);
      const adminUsers = adminResult.rows;

      // 3. Send notification to each admin
      if (adminUsers.length > 0) {
        const adminNotificationPromises = adminUsers.map(admin => 
          emailTemplates.caseAssignedNotificationToAdmin({
            admin_name: admin.first_name || 'Admin',
            admin_email: admin.email,
            case_reference: updatedCase.case_reference,
            case_type: updatedCase.case_type,
            case_sub_type: updatedCase.case_sub_type,
            priority: updatedCase.priority,
            partner_name: updatedCase.partner_name,
            assigned_to_name: updatedCase.assigned_name,
            assigned_to_role: updatedCase.assigned_role,
            assigned_by_name: assigned_by_name,
            assigned_date: new Date().toLocaleString(),
            case_id: updatedCase.id
          }).catch(err => {
            console.error(`❌ Failed to send notification to admin ${admin.email}:`, err.message);
            return null;
          })
        );

        await Promise.all(adminNotificationPromises);
        console.log(`✅ Admin notifications sent to ${adminUsers.length} admins`);
      } else {
        console.log('⚠️ No active admin users found to notify');
      }

    } catch (emailError) {
      // Log email error but don't fail the request
      console.error('❌ Error sending assignment emails:', emailError);
    }

    res.json({
      success: true,
      message: `Case assigned to ${updatedCase.assigned_name || 'team member'} successfully`,
      case: {
        id: updatedCase.id,
        case_reference: updatedCase.case_reference,
        assigned_to: updatedCase.assigned_to,
        assigned_name: updatedCase.assigned_name,
        assigned_role: updatedCase.assigned_role,
        assigned_at: updatedCase.assigned_at,
        partner_name: updatedCase.partner_name,
        status: updatedCase.status
      }
    });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Error assigning case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign case',
      error: error.message
    });
  }
});


/**
 * GET /api/cases/assigned-to/:userId
 * Get cases assigned to a specific team member (admin only)
 */
router.get('/assigned-to/:userId', authenticate, async (req, res) => {
  try {
    // Check if user is admin (optional - add your admin check)
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const { userId } = req.params;
    const { status, priority, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        id,
        case_reference,
        partner_name,
        partner_email,
        case_type,
        case_sub_type,
        priority,
        status,
        assigned_to,
        assigned_name,
        assigned_role,
        assigned_at,
        created_at
      FROM case_updated
      WHERE assigned_to = $1
    `;

    const queryParams = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (priority) {
      query += ` AND priority = $${paramIndex}`;
      queryParams.push(priority);
      paramIndex++;
    }

    query += ` ORDER BY assigned_at DESC NULLS LAST LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);

    // Get user info
    const userQuery = `SELECT id, email, first_name, last_name FROM users WHERE id = $1`;
    const userResult = await db.query(userQuery, [userId]);
    
    const userName = userResult.rows[0] 
      ? `${userResult.rows[0].first_name || ''} ${userResult.rows[0].last_name || ''}`.trim() 
      : 'Unknown User';

    res.json({
      success: true,
      user: {
        id: userId,
        name: userName || userResult.rows[0]?.email
      },
      cases: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Error fetching user cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cases',
      error: error.message
    });
  }
});

/**
 * PUT /api/cases/:caseId/assign
 * Reassign a case to a different team member
 */
router.put('/:caseId/assign', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const { assigned_to, assigned_name, assigned_role } = req.body;
    const reassigned_by = req.user.id;

    if (!assigned_to) {
      return res.status(400).json({
        success: false,
        message: 'assigned_to (user ID) is required'
      });
    }

    await db.query('BEGIN');

    // Get current assignment for logging
    const currentQuery = 'SELECT assigned_to, assigned_name FROM case_updated WHERE id = $1';
    const currentResult = await db.query(currentQuery, [caseId]);
    const previousAssignee = currentResult.rows[0];

    // Update assignment
    const updateQuery = `
      UPDATE case_updated
      SET 
        assigned_to = $1,
        assigned_name = $2,
        assigned_role = $3,
        assigned_at = NOW(),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;

    const updateResult = await db.query(updateQuery, [
      assigned_to, 
      assigned_name, 
      assigned_role, 
      caseId
    ]);

    if (updateResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // Log reassignment
    const logQuery = `
      INSERT INTO case_activity_log (
        case_id,
        user_id,
        action,
        details,
        created_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `;

    await db.query(logQuery, [
      caseId,
      reassigned_by,
      'REASSIGNED',
      JSON.stringify({
        from: previousAssignee,
        to: { id: assigned_to, name: assigned_name, role: assigned_role }
      })
    ]);

    await db.query('COMMIT');

    res.json({
      success: true,
      message: 'Case reassigned successfully',
      case: updateResult.rows[0]
    });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Error reassigning case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reassign case',
      error: error.message
    });
  }
});

/**
 * DELETE /api/cases/:caseId/assign
 * Unassign a case (remove assignment)
 */
router.delete('/:caseId/assign', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const unassigned_by = req.user.id;

    await db.query('BEGIN');

    // Get current assignment for logging
    const currentQuery = 'SELECT assigned_to, assigned_name FROM case_updated WHERE id = $1';
    const currentResult = await db.query(currentQuery, [caseId]);
    const previousAssignee = currentResult.rows[0];

    // Remove assignment
    const updateQuery = `
      UPDATE case_updated
      SET 
        assigned_to = NULL,
        assigned_name = NULL,
        assigned_role = NULL,
        assigned_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const updateResult = await db.query(updateQuery, [caseId]);

    if (updateResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // Log unassignment
    const logQuery = `
      INSERT INTO case_activity_log (
        case_id,
        user_id,
        action,
        details,
        created_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `;

    await db.query(logQuery, [
      caseId,
      unassigned_by,
      'UNASSIGNED',
      JSON.stringify(previousAssignee)
    ]);

    await db.query('COMMIT');

    res.json({
      success: true,
      message: 'Case unassigned successfully',
      case: updateResult.rows[0]
    });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Error unassigning case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unassign case',
      error: error.message
    });
  }
});

/**
 * GET /api/cases/assigned-to/:userId
 * Get all cases assigned to a specific team member
 */
router.get('/assigned-to/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, priority, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        id,
        case_reference,
        partner_name,
        partner_email,
        case_type,
        case_sub_type,
        priority,
        status,
        assigned_at,
        created_at,
        updated_at
      FROM case_updated
      WHERE assigned_to = $1
    `;

    const queryParams = [userId];
    let paramIndex = 2;

    // Add optional filters
    if (status) {
      query += ` AND status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (priority) {
      query += ` AND priority = $${paramIndex}`;
      queryParams.push(priority);
      paramIndex++;
    }

    // Add sorting and pagination
    query += ` ORDER BY assigned_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);

    // Get total count for pagination
    const countQuery = 'SELECT COUNT(*) FROM case_updated WHERE assigned_to = $1';
    const countResult = await db.query(countQuery, [userId]);

    res.json({
      success: true,
      cases: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Error fetching assigned cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned cases',
      error: error.message
    });
  }
});

/**
 * GET /api/cases/unassigned
 * Get all unassigned cases
 */
router.get('/unassigned/all', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const query = `
      SELECT 
        id,
        case_reference,
        partner_name,
        partner_email,
        case_type,
        case_sub_type,
        priority,
        status,
        created_at
      FROM case_updated
      WHERE assigned_to IS NULL
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await db.query(query, [limit, offset]);

    const countQuery = 'SELECT COUNT(*) FROM case_updated WHERE assigned_to IS NULL';
    const countResult = await db.query(countQuery);

    res.json({
      success: true,
      cases: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Error fetching unassigned cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unassigned cases',
      error: error.message
    });
  }
});

/**
 * GET /api/cases/stats/assignments
 * Get assignment statistics
 */
router.get('/stats/assignments', authenticate, async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total_cases,
        COUNT(CASE WHEN assigned_to IS NOT NULL THEN 1 END) as assigned_cases,
        COUNT(CASE WHEN assigned_to IS NULL THEN 1 END) as unassigned_cases,
        COUNT(DISTINCT assigned_to) as active_assignees
      FROM case_updated
    `;

    const result = await db.query(query);

    res.json({
      success: true,
      stats: result.rows[0]
    });

  } catch (error) {
    console.error('Error fetching assignment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment statistics',
      error: error.message
    });
  }
});



// Add this to your backend routes
router.get('/totals', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        COALESCE(SUM(total_deal_value), 0) as total_deal_value,
        COALESCE(SUM(total_profit), 0) as total_profit,
        COALESCE(SUM(commission), 0) as total_commission
      FROM case_updated
      WHERE status = 'approved'
    `;
    
    const params = [];
    
    if (startDate && endDate) {
      query += ` AND updated_at BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    }

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: {
        total_deal_value: parseFloat(result.rows[0].total_deal_value) || 0,
        total_profit: parseFloat(result.rows[0].total_profit) || 0,
        total_commission: parseFloat(result.rows[0].total_commission) || 0
      }
    });

  } catch (error) {
    console.error('Error fetching totals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch totals',
      error: error.message
    });
  }
});


// Simple stats API
router.get('/financial-summary', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COALESCE(SUM(total_deal_value), 0) as total_deal_value,
        COALESCE(SUM(total_profit), 0) as total_profit,
        COALESCE(SUM(commission), 0) as total_commission
      FROM case_updated
      WHERE status = 'approved'
    `);

    res.json({
      success: true,
      data: {
        total_deal_value: parseFloat(result.rows[0].total_deal_value),
        total_profit: parseFloat(result.rows[0].total_profit),
        total_commission: parseFloat(result.rows[0].total_commission)
      }
    });

  } catch (error) {
    console.error('Error fetching financial summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch financial summary',
      error: error.message
    });
  }
});


router.post('/', upload.any(), uploadToS3, async (req, res) => {
  try {
    const formData = req.body;

    // Handle uploaded files
    let s3_documents = [];
    if (req.files && req.files.length > 0) {
      s3_documents = (req.uploadedFiles || []).map(file => ({
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        s3Key: file.s3Key,
        bucket: file.bucket,
        url: `https://alhuda-crm.s3.me-central-1.amazonaws.com/${file.s3Key}`,
        uploadedAt: new Date().toISOString(),
        document_type: file.fieldname
      }));
    }

    const document_paths = s3_documents.map(doc => doc.s3Key);

    const {
      case_type = '',
      case_sub_type = '',
      description = '',
      additional_notes = '',
      priority = '',
      partner_name = '',
      partner_email = '',
      user_id = null,
      source = 'web_portal'
    } = formData;

    const case_reference = `CASE-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 6)
      .toUpperCase()}`;

    const main_document = s3_documents.find(
      doc => doc.document_type === 'documents'
    );

    const additional_documents = s3_documents.filter(
      doc => doc.document_type === 'additional_documents'
    );

    const query = `
      INSERT INTO case_updated (
        case_type,
        case_sub_type,
        description,
        additional_notes,
        priority,
        partner_name,
        partner_email,
        document_paths,
        s3_documents,
        user_id,
        case_reference,
        source,
        main_document,
        additional_documents,
        status,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING *;
    `;

    const values = [
      case_type,
      case_sub_type,
      description,
      additional_notes,
      priority,
      partner_name,
      partner_email,
      JSON.stringify(document_paths),
      JSON.stringify(s3_documents),
      user_id ? parseInt(user_id) : null,
      case_reference,
      source,
      main_document ? JSON.stringify(main_document) : null,
      additional_documents.length > 0
        ? JSON.stringify(additional_documents)
        : null,
      'pending',
      new Date(),
      new Date()
    ];

    const result = await db.query(query, values);
    const insertedCase = result.rows[0];

    // 📧 SEND EMAIL NOTIFICATIONS - FIXED: Only one admin email
    try {
      // 1. Send email to the partner/sub consultant
      if (partner_email) {
        await emailTemplates.caseSubmittedToPartner({
          partner_name: partner_name || 'Valued Partner',
          partner_email: partner_email,
          case_reference: insertedCase.case_reference,
          case_type: insertedCase.case_type,
          case_sub_type: insertedCase.case_sub_type,
          description: insertedCase.description,
          priority: insertedCase.priority,
          submitted_date: new Date().toLocaleString(),
          document_count: s3_documents.length
        });
        console.log(`✅ Case submission email sent to partner: ${partner_email}`);
      }

      // 2. Send ONLY ONE email to the admin - NO LOOP, HARDCODED EMAIL
      const ADMIN_EMAIL = 'tech@alhudafinancial.com'; // Your single admin email
      
      await emailTemplates.newCaseNotificationToAdmin({
        admin_name: 'Admin',
        admin_email: ADMIN_EMAIL,
        partner_name: partner_name || 'A partner',
        partner_email: partner_email,
        case_reference: insertedCase.case_reference,
        case_type: insertedCase.case_type,
        case_sub_type: insertedCase.case_sub_type,
        description: insertedCase.description,
        priority: insertedCase.priority,
        submitted_date: new Date().toLocaleString(),
        document_count: s3_documents.length,
        case_id: insertedCase.id
      });
      
      console.log(`✅ Admin notification sent to: ${ADMIN_EMAIL}`);

    } catch (emailError) {
      // Log email error but don't fail the request
      console.error('❌ Error sending case submission emails:', emailError);
    }

    res.status(201).json({
      success: true,
      data: {
        id: insertedCase.id,
        case_type: insertedCase.case_type,
        case_sub_type: insertedCase.case_sub_type,
        description: insertedCase.description,
        additional_notes: insertedCase.additional_notes,
        priority: insertedCase.priority,
        partner_name: insertedCase.partner_name,
        partner_email: insertedCase.partner_email,
        case_reference: insertedCase.case_reference,
        status: insertedCase.status,
        documents: {
          main: main_document || null,
          additional: additional_documents
        },
        uploaded_at: insertedCase.created_at
      }
    });

  } catch (error) {
    console.error('Error creating case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create case',
      error: error.message
    });
  }
});


router.put('/:id', upload.any(), uploadToS3, async (req, res) => {
  try {
    const caseId = req.params.id;
    const formData = req.body;
    
    // First, get existing case data
    const existingCaseQuery = `SELECT * FROM case_updated WHERE id = $1`;
    const existingCaseResult = await db.query(existingCaseQuery, [caseId]);
    
    if (existingCaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }
    
    const existingCase = existingCaseResult.rows[0];
    
    // Handle new uploaded files
    let newDocuments = [];
    if (req.files && req.files.length > 0) {
      newDocuments = (req.uploadedFiles || []).map(file => ({
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        s3Key: file.s3Key,
        bucket: file.bucket,
        url: `https://alhuda-crm.s3.me-central-1.amazonaws.com/${file.s3Key}`,
        uploadedAt: new Date().toISOString(),
        document_type: file.fieldname
      }));
    }
    
    // Merge existing documents with new ones
    let existingS3Documents = existingCase.s3_documents || [];
    if (typeof existingS3Documents === 'string') {
      existingS3Documents = JSON.parse(existingS3Documents);
    }
    
    let existingDocumentPaths = existingCase.document_paths || [];
    if (typeof existingDocumentPaths === 'string') {
      existingDocumentPaths = JSON.parse(existingDocumentPaths);
    }
    
    // Add new documents to existing arrays
    const updatedS3Documents = [...existingS3Documents, ...newDocuments];
    const updatedDocumentPaths = [
      ...existingDocumentPaths,
      ...newDocuments.map(doc => doc.s3Key)
    ];
    
    // Determine main and additional documents (combine existing and new)
    let existingMainDocument = existingCase.main_document;
    if (typeof existingMainDocument === 'string') {
      existingMainDocument = JSON.parse(existingMainDocument);
    }
    
    let existingAdditionalDocuments = existingCase.additional_documents || [];
    if (typeof existingAdditionalDocuments === 'string') {
      existingAdditionalDocuments = JSON.parse(existingAdditionalDocuments);
    }
    
    // Update main document if a new main document is uploaded
    let updatedMainDocument = existingMainDocument;
    const newMainDocument = newDocuments.find(doc => doc.document_type === 'documents');
    if (newMainDocument) {
      updatedMainDocument = newMainDocument;
    }
    
    // Update additional documents
    const newAdditionalDocuments = newDocuments.filter(doc => doc.document_type === 'additional_documents');
    const updatedAdditionalDocuments = [...existingAdditionalDocuments, ...newAdditionalDocuments];
    
    // Prepare update fields (only update fields that are provided)
    const {
      case_type,
      case_sub_type,
      description,
      additional_notes,
      priority,
      partner_name,
      partner_email,
      user_id,
      source,
      status
    } = formData;
    
    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCounter = 1;
    
    if (case_type !== undefined) {
      updateFields.push(`case_type = $${paramCounter++}`);
      values.push(case_type);
    }
    if (case_sub_type !== undefined) {
      updateFields.push(`case_sub_type = $${paramCounter++}`);
      values.push(case_sub_type);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCounter++}`);
      values.push(description);
    }
    if (additional_notes !== undefined) {
      updateFields.push(`additional_notes = $${paramCounter++}`);
      values.push(additional_notes);
    }
    if (priority !== undefined) {
      updateFields.push(`priority = $${paramCounter++}`);
      values.push(priority);
    }
    if (partner_name !== undefined) {
      updateFields.push(`partner_name = $${paramCounter++}`);
      values.push(partner_name);
    }
    if (partner_email !== undefined) {
      updateFields.push(`partner_email = $${paramCounter++}`);
      values.push(partner_email);
    }
    if (user_id !== undefined) {
      updateFields.push(`user_id = $${paramCounter++}`);
      values.push(user_id ? parseInt(user_id) : null);
    }
    if (source !== undefined) {
      updateFields.push(`source = $${paramCounter++}`);
      values.push(source);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCounter++}`);
      values.push(status);
    }
    
    // Always update these if there are new documents
    if (newDocuments.length > 0) {
      updateFields.push(`document_paths = $${paramCounter++}`);
      values.push(JSON.stringify(updatedDocumentPaths));
      
      updateFields.push(`s3_documents = $${paramCounter++}`);
      values.push(JSON.stringify(updatedS3Documents));
      
      updateFields.push(`main_document = $${paramCounter++}`);
      values.push(updatedMainDocument ? JSON.stringify(updatedMainDocument) : null);
      
      updateFields.push(`additional_documents = $${paramCounter++}`);
      values.push(updatedAdditionalDocuments.length > 0 ? JSON.stringify(updatedAdditionalDocuments) : null);
    }
    
    // Always update the updated_at timestamp
    updateFields.push(`updated_at = $${paramCounter++}`);
    values.push(new Date());
    
    if (updateFields.length === 1 && newDocuments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    // Add case ID as the last parameter
    values.push(caseId);
    
    const query = `
      UPDATE case_updated 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *;
    `;
    
    const result = await db.query(query, values);
    const updatedCase = result.rows[0];
    
    // Send email notifications for the update
    try {
      // Notify partner about the update if there are changes or new documents
      if (updatedCase.partner_email && (Object.keys(formData).length > 0 || newDocuments.length > 0)) {
        await emailTemplates.caseUpdatedNotification({
          partner_name: updatedCase.partner_name || 'Valued Partner',
          partner_email: updatedCase.partner_email,
          case_reference: updatedCase.case_reference,
          case_type: updatedCase.case_type,
          case_sub_type: updatedCase.case_sub_type,
          updated_fields: Object.keys(formData).join(', '),
          new_documents_count: newDocuments.length,
          update_date: new Date().toLocaleString(),
          status: updatedCase.status,
          additional_notes: updatedCase.additional_notes
        });
        console.log(`✅ Case update email sent to partner: ${updatedCase.partner_email}`);
      }
      
      // Notify admin about the update
      const ADMIN_EMAIL = 'tech@alhudafinancial.com';
      await emailTemplates.caseUpdatedAdminNotification({
        admin_name: 'Admin',
        admin_email: ADMIN_EMAIL,
        partner_name: updatedCase.partner_name,
        partner_email: updatedCase.partner_email,
        case_reference: updatedCase.case_reference,
        case_type: updatedCase.case_type,
        case_sub_type: updatedCase.case_sub_type,
        updated_fields: Object.keys(formData).join(', '),
        new_documents_count: newDocuments.length,
        update_date: new Date().toLocaleString(),
        status: updatedCase.status,
        case_id: updatedCase.id
      });
      console.log(`✅ Admin update notification sent to: ${ADMIN_EMAIL}`);
      
    } catch (emailError) {
      console.error('❌ Error sending case update emails:', emailError);
    }
    
    // Parse JSON fields for response
    const responseData = {
      ...updatedCase,
      s3_documents: typeof updatedCase.s3_documents === 'string' 
        ? JSON.parse(updatedCase.s3_documents) 
        : updatedCase.s3_documents,
      document_paths: typeof updatedCase.document_paths === 'string' 
        ? JSON.parse(updatedCase.document_paths) 
        : updatedCase.document_paths,
      main_document: typeof updatedCase.main_document === 'string' 
        ? JSON.parse(updatedCase.main_document) 
        : updatedCase.main_document,
      additional_documents: typeof updatedCase.additional_documents === 'string' 
        ? JSON.parse(updatedCase.additional_documents || '[]') 
        : updatedCase.additional_documents
    };
    
    res.status(200).json({
      success: true,
      message: 'Case updated successfully',
      data: {
        id: responseData.id,
        case_type: responseData.case_type,
        case_sub_type: responseData.case_sub_type,
        description: responseData.description,
        additional_notes: responseData.additional_notes,
        priority: responseData.priority,
        partner_name: responseData.partner_name,
        partner_email: responseData.partner_email,
        case_reference: responseData.case_reference,
        status: responseData.status,
        documents: {
          main: responseData.main_document || null,
          additional: responseData.additional_documents || [],
          all: responseData.s3_documents || []
        },
        updated_at: responseData.updated_at,
        new_documents_added: newDocuments.length
      }
    });
    
  } catch (error) {
    console.error('Error updating case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update case',
      error: error.message
    });
  }
});

// GET endpoint - Get all cases
router.get('/', async (req, res) => {
  try {
    const query = 'SELECT * FROM case_updated ORDER BY created_at DESC';
    const result = await db.query(query);
    
    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cases',
      error: error.message
    });
  }
});

router.get('/allcases', async (req, res) => {
  try {
    const query = `
      SELECT
        c.*,                        
        cs.status,
        cs.remarks,
        cs.updated_at AS status_updated_at
      FROM case_updated c
      LEFT JOIN case_status cs
        ON cs.case_id = c.id
      ORDER BY c.created_at DESC
    `;

    const result = await db.query(query);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching pending cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending cases',
      error: error.message
    });
  }
});

// Simple client statistics
router.get('/client-summary', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        partner_name,
        partner_email,
        COUNT(*) as total_cases,
        COALESCE(SUM(total_deal_value), 0) as total_deal_value,
        COALESCE(SUM(commission), 0) as total_commission
      FROM case_updated
      WHERE partner_name IS NOT NULL 
        AND partner_name != ''
        AND status = 'approved'
      GROUP BY partner_name, partner_email
      ORDER BY total_deal_value DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(row => ({
        partner_name: row.partner_name,
        partner_email: row.partner_email,
        total_cases: parseInt(row.total_cases),
        total_deal_value: parseFloat(row.total_deal_value),
        total_commission: parseFloat(row.total_commission)
      }))
    });

  } catch (error) {
    console.error('Error fetching client summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client summary',
      error: error.message
    });
  }
});


router.get('/pending', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM case_updated
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `;

    const result = await db.query(query);

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching pending cases:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


router.get('/approved', async (req, res) => {
  try {
    const query = `
        SELECT
        c.id,
        c.case_reference,
        c.case_type,
        c.case_sub_type,
        c.description,
        c.priority,
        c.partner_name,
        c.partner_email,
        c.status,
        cs.remarks,
        c.created_at,
        c.updated_at,
        c.main_document,
        c.additional_documents
      FROM case_updated c
      LEFT JOIN case_status cs ON cs.case_id = c.id
      WHERE c.status = 'approved'
      ORDER BY c.updated_at DESC
    `;

    const result = await db.query(query);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching approved cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved cases',
      error: error.message
    });
  }
});

router.get('/rejected', async (req, res) => {
  try {
    const query = `
      SELECT
        c.id,
        c.case_reference,
        c.case_type,
        c.case_sub_type,
        c.description,
        c.priority,
        c.partner_name,
        c.partner_email,
        c.status,
        c.main_document,
        c.additional_documents,
        cs.remarks,
        c.created_at,
        c.updated_at
      FROM case_updated c
      LEFT JOIN case_status cs ON cs.case_id = c.id
      WHERE c.status = 'rejected'
      ORDER BY c.updated_at DESC
    `;

    const result = await db.query(query);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching rejected cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rejected cases',
      error: error.message
    });
  }
});



/**
 * GET /api/cases/my-assigned-cases
 * Get all cases assigned to the currently logged-in team member
 * This uses the authenticated user's ID from the token
 */
/**
 * GET /api/cases/my-assigned-cases
 * Get all cases assigned to the currently logged-in team member
 * This uses the authenticated user's ID from the token
 */
router.get('/my-assigned-cases', authenticate, async (req, res) => {
  try {
    const userId = req.user.id; // Get current user ID from auth middleware
    const { status, priority, limit = 50, offset = 0, search } = req.query;

    console.log(`📋 Fetching cases assigned to current user: ${userId}`);

    // Validate pagination parameters
    const limitNum = parseInt(limit);
    const offsetNum = parseInt(offset);
    
    // Base query with JOIN to case_status table
    let query = `
      SELECT 
        c.*,
        cs.status,
        cs.remarks,
        cs.updated_at AS status_updated_at
      FROM case_updated c
      LEFT JOIN case_status cs ON cs.case_id = c.id
      WHERE c.assigned_to = $1
    `;

    const queryParams = [userId];
    let paramIndex = 2;

    // Add status filter if provided (using the case_status table)
    if (status) {
      query += ` AND cs.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Add priority filter if provided (using the case_updated table)
    if (priority) {
      query += ` AND c.priority = $${paramIndex}`;
      queryParams.push(priority);
      paramIndex++;
    }

    // Add search functionality if provided
    if (search) {
      query += ` AND (
        c.case_reference ILIKE $${paramIndex} OR 
        c.partner_name ILIKE $${paramIndex} OR 
        c.partner_email ILIKE $${paramIndex} OR 
        c.case_type ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Add sorting - order by priority (urgent first), then by date
    query += ` ORDER BY 
      CASE 
        WHEN c.priority = 'urgent' THEN 1
        WHEN c.priority = 'high' THEN 2
        WHEN c.priority = 'medium' THEN 3
        WHEN c.priority = 'low' THEN 4
        ELSE 5
      END ASC,
      c.assigned_at DESC NULLS LAST, 
      c.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    
    queryParams.push(limitNum, offsetNum);

    console.log('Executing query for my-assigned-cases with JOIN');
    
    const result = await db.query(query, queryParams);

    // Get total count for pagination (with same filters)
    let countQuery = `
      SELECT COUNT(*) 
      FROM case_updated c
      LEFT JOIN case_status cs ON cs.case_id = c.id
      WHERE c.assigned_to = $1
    `;
    
    const countParams = [userId];
    let countParamIndex = 2;
    
    if (status) {
      countQuery += ` AND cs.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }
    
    if (priority) {
      countQuery += ` AND c.priority = $${countParamIndex}`;
      countParams.push(priority);
      countParamIndex++;
    }
    
    if (search) {
      countQuery += ` AND (
        c.case_reference ILIKE $${countParamIndex} OR 
        c.partner_name ILIKE $${countParamIndex} OR 
        c.partner_email ILIKE $${countParamIndex} OR 
        c.case_type ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
    }
    
    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Get summary statistics for this user
    const summaryQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN cs.status = 'pending' OR cs.status = 'submitted' THEN 1 END) as pending,
        COUNT(CASE WHEN cs.status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN cs.status = 'under_review' THEN 1 END) as under_review,
        COUNT(CASE WHEN cs.status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN cs.status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN c.priority = 'urgent' THEN 1 END) as urgent,
        COUNT(CASE WHEN c.priority = 'high' THEN 1 END) as high_priority
      FROM case_updated c
      LEFT JOIN case_status cs ON cs.case_id = c.id
      WHERE c.assigned_to = $1
    `;
    
    const summaryResult = await db.query(summaryQuery, [userId]);

    // Process the results to combine case data with latest status
    const cases = result.rows.map(row => {
      // Remove the joined fields to avoid duplication
      const { status, remarks, status_updated_at, ...caseData } = row;
      
      return {
        ...caseData,
        status: status || caseData.status, // Use case_status if available, fallback to case_updated.status
        remarks: remarks,
        status_updated_at: status_updated_at
      };
    });

    res.json({
      success: true,
      message: `Found ${cases.length} cases assigned to you`,
      cases: cases,
      summary: summaryResult.rows[0],
      pagination: {
        total: totalCount,
        limit: limitNum,
        offset: offsetNum,
        currentPage: Math.floor(offsetNum / limitNum) + 1,
        totalPages: Math.ceil(totalCount / limitNum)
      },
      user: {
        id: userId,
        name: req.user.name || req.user.email
      }
    });

  } catch (error) {
    console.error('❌ Error fetching my assigned cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your assigned cases',
      error: error.message
    });
  }
});



router.get('/my-cases', async (req, res) => {
  try {
    // Get user ID from query
    const userId = req.query.user_id || req.query.userId || req.query.id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required. Example: /api/cases/my-cases?user_id=12'
      });
    }

    // Parse to integer (since user_id is INTEGER type)
    const parsedUserId = parseInt(userId);
    
    if (isNaN(parsedUserId)) {
      return res.status(400).json({
        success: false,
        message: 'User ID must be a number'
      });
    }

    console.log(`Fetching cases for user_id: ${parsedUserId}`);
    
    // Simple query using user_id column
    const query = `
      SELECT * FROM case_updated 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    
    const result = await db.query(query, [parsedUserId]);
    
    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows,
      user_id: parsedUserId
    });
    
  } catch (error) {
    console.error('Error fetching user cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user cases',
      error: error.message,
      user_id_requested: req.query.user_id || req.query.userId || req.query.id
    });
  }
});


router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT * 
      FROM case_updated 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await db.query(query, [userId]);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching user cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user cases',
      error: error.message
    });
  }
});

router.put('/:id/approve', authenticate, async (req, res) => {
    try {
        const caseId = req.params.id;
        const { notes } = req.body;
        const userId = req.user?.id || req.user?.user_id; // Try different property names

        // 1. First check if case exists
        const caseCheck = await db.query(
            `SELECT id, status FROM case_updated WHERE id = $1`,
            [caseId]
        );

        if (caseCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        const currentCase = caseCheck.rows[0];
        
        // Optional: Check if case is already approved
        if (currentCase.status === 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Case is already approved'
            });
        }

        // 2. Update cases table status
        await db.query(
            `UPDATE case_updated SET 
                status = 'approved',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [caseId]
        );

        // 3. Log the action
        await db.query(
            `INSERT INTO case_actions (case_id, action, notes, user_id)
             VALUES ($1, 'approve', $2, $3)`,
            [caseId, notes || 'Case approved', userId]
        );

        // 4. Get updated case data
        const updatedCase = await db.query(
            `SELECT c.*, u.name as partner_name, u.email as partner_email
             FROM case_updated c
             LEFT JOIN users u ON c.user_id = u.id
             WHERE c.id = $1`,
            [caseId]
        );

        res.json({
            success: true,
            message: 'Case approved successfully',
            data: updatedCase.rows[0]
        });

    } catch (error) {
        console.error('Error approving case:', error);
        
        // More specific error messages
        if (error.code === '23503') { // Foreign key violation
            return res.status(404).json({
                success: false,
                message: 'Case not found or invalid case ID'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Server error while approving case',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// =============== REJECT CASE ===============
router.put('/:id/reject', authenticate, async (req, res) => {
    try {
        const caseId = req.params.id;
        const { reason, notes } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'Reason is required for rejection'
            });
        }

        // 1. Update cases table status
        await db.query(
            `UPDATE cases SET status = 'rejected' WHERE id = $1`,
            [caseId]
        );

        // 2. Log the action
        await db.query(
            `INSERT INTO case_actions (case_id, action, reason, notes, user_id)
             VALUES ($1, 'reject', $2, $3, $4)`,
            [caseId, reason, notes || '', userId]
        );

        res.json({
            success: true,
            message: 'Case rejected successfully'
        });

    } catch (error) {
        console.error('Error rejecting case:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// =============== GET PENDING CASES ===============


// =============== GET REJECTED CASES ===============
router.get('/rejected', authenticate, async (req, res) => {
    try {
        const rejectedCases = await db.query(
            `SELECT 
                c.*, 
                u.name as partner_name, 
                u.email as partner_email,
                ca.reason as rejection_reason,
                ca.notes as rejection_notes,
                ca.created_at as rejected_at,
                au.name as rejected_by
             FROM cases c
             LEFT JOIN users u ON c.user_id = u.id
             LEFT JOIN case_actions ca ON c.id = ca.case_id AND ca.action = 'reject'
             LEFT JOIN users au ON ca.user_id = au.id
             WHERE c.status = 'rejected'
             ORDER BY ca.created_at DESC`
        );

        res.json({
            success: true,
            data: rejectedCases.rows
        });

    } catch (error) {
        console.error('Error fetching rejected cases:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// =============== GET CASE HISTORY ===============
router.get('/:id/history', authenticate, async (req, res) => {
    try {
        const caseId = req.params.id;

        const history = await db.query(
            `SELECT 
                ca.*,
                u.name as user_name,
                u.email as user_email,
                u.role as user_role
             FROM case_actions ca
             LEFT JOIN users u ON ca.user_id = u.id
             WHERE ca.case_id = $1
             ORDER BY ca.created_at DESC`,
            [caseId]
        );

        res.json({
            success: true,
            data: history.rows
        });

    } catch (error) {
        console.error('Error fetching case history:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// =============== REOPEN REJECTED CASE ===============
router.put('/:id/reopen', authenticate, async (req, res) => {
    try {
        const caseId = req.params.id;
        const userId = req.user.id;

        // 1. Update cases table status
        await db.query(
            `UPDATE cases 
             SET status = 'pending_review' 
             WHERE id = $1 AND status = 'rejected'`,
            [caseId]
        );

        // 2. Log the reopen action
        await db.query(
            `INSERT INTO case_actions (case_id, action, notes, user_id)
             VALUES ($1, 'reopen', 'Case reopened for review', $2)`,
            [caseId, userId]
        );

        res.json({
            success: true,
            message: 'Case reopened successfully'
        });

    } catch (error) {
        console.error('Error reopening case:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

router.get('/details/:id', async (req, res) => {
  try {
    const { id } = req.params; // ✅ lowercase

    const query = `
      SELECT *
      FROM case_updated
      WHERE id = $1
      LIMIT 1;
    `;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0] // ✅ single object, not array
    });

  } catch (error) {
    console.error('Error fetching case by id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch case',
      error: error.message
    });
  }
});


// Alternative: Get cases by submitted_by (string field)
router.get('/by-submitter', async (req, res) => {
  try {
    const { submitted_by } = req.query;
    
    if (!submitted_by) {
      return res.status(400).json({
        success: false,
        message: 'Submitter ID is required'
      });
    }

    const query = `
      SELECT * FROM case_updated 
      WHERE submitted_by = $1 
      ORDER BY created_at DESC
    `;
    
    const result = await db.query(query, [submitted_by]);
    
    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Error fetching cases by submitter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cases',
      error: error.message
    });
  }
});

// Combined endpoint that tries multiple user identifier fields
router.get('/user-cases', async (req, res) => {
  try {
    const { user_id, submitted_by, email } = req.query;
    
    if (!user_id && !submitted_by && !email) {
      return res.status(400).json({
        success: false,
        message: 'At least one identifier (user_id, submitted_by, or email) is required'
      });
    }

    let query = 'SELECT * FROM case_updated WHERE ';
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (user_id) {
      // Try to parse as integer for user_id column
      const parsedUserId = parseInt(user_id);
      if (!isNaN(parsedUserId)) {
        conditions.push(`(user_id = $${paramCount} OR submitted_by = $${paramCount}::text)`);
        values.push(parsedUserId);
        paramCount++;
      }
    }

    if (submitted_by && !user_id) {
      conditions.push(`submitted_by = $${paramCount}`);
      values.push(submitted_by);
      paramCount++;
    }

    if (email && !user_id && !submitted_by) {
      conditions.push(`client_email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    query += conditions.join(' OR ');
    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, values);
    
    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Error fetching user cases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user cases',
      error: error.message
    });
  }
});

module.exports = router;