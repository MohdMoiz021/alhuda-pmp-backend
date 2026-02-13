


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
    const { status, remarks = '', updated_by = null } = req.body;

    // Validate status
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // Check if case exists
    const caseCheck = await db.query(
      'SELECT * FROM case_updated WHERE id = $1',
      [caseId]
    );

    if (!caseCheck.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    // 1️⃣ Update the main case status
    const updatedCase = await db.query(
      `
      UPDATE case_updated
      SET status = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *;
      `,
      [status, caseId]
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

    // Validate input
    if (!assigned_to) {
      return res.status(400).json({
        success: false,
        message: 'assigned_to (user ID) is required'
      });
    }

    // Start transaction for data consistency
    await db.query('BEGIN');

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
        status
    `;

    const updateResult = await db.query(updateQuery, [
      assigned_to, 
      assigned_name || null, 
      assigned_role || null, 
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

    // Optional: Log assignment in activity log
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
        assigned_name,
        assigned_role,
        previous_assignee: null // You could fetch previous if needed
      })
    ]);

    await db.query('COMMIT');

    res.json({
      success: true,
      message: `Case assigned to ${assigned_name || 'team member'} successfully`,
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




// Use .any() to accept all files regardless of field name
// const upload = multer({ 
//   storage: storage,
//   limits: { fileSize: 10 * 1024 * 1024 }
// });

// POST endpoint - Create a new case
// router.post('/', upload.any(), async (req, res) => {
//   try {
//     console.log('Files received:', req.files?.length || 0);
//     console.log('Body fields:', Object.keys(req.body).length);

//     // All form fields are in req.body (multer puts them there)
//     const formData = req.body;
    
//     // Handle uploaded files
//     let document_paths = [];
//     if (req.files && req.files.length > 0) {
//       document_paths = req.files.map(file => file.path);
//       console.log('Document paths:', document_paths);
//     }

//     // Extract all fields with default values
//     const {
//       client_name = '',
//       client_email = '',
//       client_phone = '',
//       company_name = '',
//       company_location = '',
//       established_date = null,
//       company_type = '',
//       business_activity = '',
//       company_size = '',
//       case_type = '',
//       deal_value = null,
//       description = '',
//       additional_notes = '',
//       preferred_bank = '',
//       timeline = '',
//       expected_closure = null,
//       deal_structure = '',
//       total_amount = null,
//       commission_percentage = 15.00,
//       commission_amount = null,
//       processing_fee = null,
//       processing_time = '',
//       priority = '',
//       payment_terms = '',
//       contact_method = '',
//       contact_time = '',
//       language = '',
//       submitted_by = '',
//       user_id = null,
//       partner_name = '',
//       partner_email = '',
//       submitted_at = new Date().toISOString(),
//       source = '',
//       commission_rate = null
//     } = formData;

//     // Parse numeric values
//     const parsedDealValue = deal_value ? parseFloat(deal_value) : null;
//     const parsedTotalAmount = total_amount ? parseFloat(total_amount) : null;
//     const parsedCommissionPercentage = commission_percentage ? parseFloat(commission_percentage) : 15.00;
//     const parsedCommissionAmount = commission_amount ? parseFloat(commission_amount) : null;
//     const parsedProcessingFee = processing_fee ? parseFloat(processing_fee) : null;
//     const parsedUserId = user_id ? parseInt(user_id) : null;
//     const parsedCommissionRate = commission_rate ? parseFloat(commission_rate) : null;

//     // Check if we have the extended columns in the database
//     // Try the extended insert first
//     try {
//       const query = `
//         INSERT INTO case_updated (
//           client_name, client_email, client_phone, company_name,
//           company_location, established_date, company_type,
//           business_activity, company_size, case_type, deal_value,
//           description, additional_notes, preferred_bank, timeline,
//           expected_closure, deal_structure, total_amount,
//           commission_percentage, commission_amount, processing_fee,
//           processing_time, priority, payment_terms,
//           contact_method, contact_time, language,
//           document_paths, submitted_by, user_id,
//           partner_name, partner_email, submitted_at,
//           source, commission_rate, created_at, updated_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
//           $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
//           $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
//         RETURNING *;
//       `;

//       const values = [
//         client_name, client_email, client_phone, company_name,
//         company_location, established_date || null, company_type,
//         business_activity, company_size, case_type, 
//         parsedDealValue, description, additional_notes, preferred_bank, 
//         timeline, expected_closure || null, deal_structure,
//         parsedTotalAmount, parsedCommissionPercentage, parsedCommissionAmount, 
//         parsedProcessingFee, processing_time, priority, payment_terms,
//         contact_method, contact_time, language,
//         JSON.stringify(document_paths), submitted_by, parsedUserId,
//         partner_name || null, partner_email || null, submitted_at,
//         source, parsedCommissionRate,
//         new Date().toISOString(), // created_at
//         new Date().toISOString()  // updated_at
//       ];

//       const result = await db.query(query, values);
      
//       res.status(201).json({
//         success: true,
//         message: 'Case created successfully',
//         data: result.rows[0],
//         files_uploaded: document_paths.length
//       });

//     } catch (dbError) {
//       // If extended insert fails, try basic insert
//       console.log('Extended insert failed, trying basic:', dbError.message);
      
//       const basicQuery = `
//         INSERT INTO case_updated (
//           client_name, client_email, client_phone, company_name,
//           company_location, established_date, company_type,
//           business_activity, company_size, case_type, deal_value,
//           description, additional_notes, preferred_bank, timeline,
//           expected_closure, deal_structure, total_amount,
//           commission_percentage, commission_amount, processing_fee,
//           processing_time, priority, payment_terms,
//           created_at, updated_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
//           $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
//         RETURNING *;
//       `;

//       const basicValues = [
//         client_name, client_email, client_phone, company_name,
//         company_location, established_date || null, company_type,
//         business_activity, company_size, case_type, 
//         parsedDealValue, description, additional_notes, preferred_bank, 
//         timeline, expected_closure || null, deal_structure,
//         parsedTotalAmount, parsedCommissionPercentage, parsedCommissionAmount, 
//         parsedProcessingFee, processing_time, priority, payment_terms,
//         new Date().toISOString(), // created_at
//         new Date().toISOString()  // updated_at
//       ];

//       const result = await db.query(basicQuery, basicValues);
      
//       // Store extra fields in additional_notes if needed
//       const extraFields = {
//         contact_method,
//         contact_time,
//         language,
//         document_paths,
//         submitted_by,
//         user_id: parsedUserId,
//         partner_name,
//         partner_email,
//         submitted_at,
//         source,
//         commission_rate: parsedCommissionRate
//       };
      
//       // Update the record with extra info in additional_notes
//       if (Object.values(extraFields).some(val => val !== null && val !== '')) {
//         const extraNotes = `\n\nAdditional Data: ${JSON.stringify(extraFields, null, 2)}`;
//         const updateQuery = `
//           UPDATE case_updated 
//           SET additional_notes = COALESCE(additional_notes, '') || $1
//           WHERE id = $2
//         `;
//         await db.query(updateQuery, [extraNotes, result.rows[0].id]);
//       }

//       res.status(201).json({
//         success: true,
//         message: 'Case created successfully (using basic columns)',
//         data: result.rows[0],
//         extra_data_stored: extraFields,
//         files_uploaded: document_paths.length
//       });
//     }

//   } catch (error) {
//     console.error('Error creating case:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create case',
//       error: error.message,
//       received_body_keys: Object.keys(req.body || {})
//     });
//   }
// });

// router.post('/', upload.array('documents', 5), uploadToS3, async (req, res) => {
//   try {
//     const formData = req.body;

//     // Handle uploaded files
//     let s3_documents = [];
//     if (req.files && req.files.length > 0) {
//       s3_documents = (req.uploadedFiles || []).map(file => ({
//         originalName: file.originalName,
//         mimeType: file.mimeType,
//         size: file.size,
//         s3Key: file.s3Key,
//         bucket: file.bucket,
//         url: `https://alhuda-crm.s3.me-central-1.amazonaws.com/${file.s3Key}`,
//         uploadedAt: new Date().toISOString()
//       }));
//     }

//     const document_paths = s3_documents.map(doc => doc.s3Key);

//     const {
//       client_name = '',
//       client_email = '',
//       client_phone = '',
//       company_name = '',
//       company_location = '',
//       established_date = null,
//       company_type = '',
//       business_activity = '',
//       company_size = '',
//       case_type = '',
//       deal_value = null,
//       description = '',
//       additional_notes = '',
//       preferred_bank = '',
//       timeline = '',
//       expected_closure = null,
//       deal_structure = '',
//       total_amount = null,
//       commission_percentage = '15.00',
//       commission_amount = null,
//       processing_fee = null,
//       processing_time = '',
//       priority = '',
//       payment_terms = '',
//       user_id = null,
//       case_reference = null
//     } = formData;

//     // Generate case reference if not provided
//     const generatedCaseRef = case_reference || `CASE-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

//     const query = `
//       INSERT INTO case_updated (
//         client_name, client_email, client_phone, company_name,
//         company_location, established_date, company_type,
//         business_activity, company_size, case_type, deal_value,
//         description, additional_notes, preferred_bank, timeline,
//         expected_closure, deal_structure, total_amount,
//         commission_percentage, commission_amount, processing_fee,
//         processing_time, priority, payment_terms,
//         document_paths, s3_documents, user_id, case_reference,
//         created_at, updated_at
//       ) VALUES (
//         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
//         $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
//       )
//       RETURNING *;
//     `;

//     const values = [
//       client_name, client_email, client_phone, company_name,
//       company_location, established_date, company_type,
//       business_activity, company_size, case_type, deal_value,
//       description, additional_notes, preferred_bank, timeline,
//       expected_closure, deal_structure, total_amount,
//       commission_percentage, commission_amount, processing_fee,
//       processing_time, priority, payment_terms,
//       JSON.stringify(document_paths),
//       JSON.stringify(s3_documents),
//       user_id ? parseInt(user_id) : null,
//       generatedCaseRef,
//       new Date().toISOString(),
//       new Date().toISOString()
//     ];

//     const result = await db.query(query, values);

//     res.status(201).json({
//        success: true,
//       id: result.rows[0].id,
//       client_name: result.rows[0].client_name,
//       client_email: result.rows[0].client_email,
//       client_phone: result.rows[0].client_phone,
//       company_name: result.rows[0].company_name,
//       company_location: result.rows[0].company_location,
//       established_date: result.rows[0].established_date,
//       company_type: result.rows[0].company_type,
//       business_activity: result.rows[0].business_activity,
//       company_size: result.rows[0].company_size,
//       case_type: result.rows[0].case_type,
//       deal_value: result.rows[0].deal_value,
//       description: result.rows[0].description,
//       additional_notes: result.rows[0].additional_notes,
//       preferred_bank: result.rows[0].preferred_bank,
//       timeline: result.rows[0].timeline,
//       expected_closure: result.rows[0].expected_closure,
//       deal_structure: result.rows[0].deal_structure,
//       total_amount: result.rows[0].total_amount,
//       commission_percentage: result.rows[0].commission_percentage,
//       commission_amount: result.rows[0].commission_amount,
//       processing_fee: result.rows[0].processing_fee,
//       processing_time: result.rows[0].processing_time,
//       priority: result.rows[0].priority,
//       payment_terms: result.rows[0].payment_terms,
//       user_id: result.rows[0].user_id,
//       s3_documents,
//       case_reference: result.rows[0].case_reference,
//       document_paths
//     });

//   } catch (error) {
//     console.error('Error creating case:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create case',
//       error: error.message
//     });
//   }
// });

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
      'pending', // ✅ DEFAULT STATUS
      new Date(),
      new Date()
    ];

    const result = await db.query(query, values);
    const insertedCase = result.rows[0];

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
        status: insertedCase.status, // ✅ pending
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






// Get cases by user_id (for authenticated users)
// router.get('/my-cases', async (req, res) => {
//   try {
//     // Get user_id from query parameter (sent by frontend)
//     const { user_id } = req.query;
    
//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: 'User ID is required'
//       });
//     }

//     // Parse user_id to integer
//     const parsedUserId = parseInt(user_id);
    
//     if (isNaN(parsedUserId)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid User ID'
//       });
//     }

//     // Query to get cases by user_id
//     // Check if the 'submitted_by' or 'user_id' column exists
//     let query;
//     let values = [parsedUserId];
    
//     // Try to check which column exists
//     try {
//       // First check if user_id column exists
//       const checkColumnsQuery = `
//         SELECT column_name 
//         FROM information_schema.columns 
//         WHERE table_name = 'case_updated' 
//         AND column_name IN ('user_id', 'submitted_by')
//       `;
      
//       const columnCheck = await db.query(checkColumnsQuery);
//       const columns = columnCheck.rows.map(row => row.column_name);
      
//       if (columns.includes('user_id')) {
//         query = `
//           SELECT * FROM case_updated 
//           WHERE user_id = $1 
//           ORDER BY created_at DESC
//         `;
//       } else if (columns.includes('submitted_by')) {
//         query = `
//           SELECT * FROM case_updated 
//           WHERE submitted_by::integer = $1 
//           ORDER BY created_at DESC
//         `;
//       } else {
//         // If neither column exists, return all cases (or empty if you prefer)
//         query = `
//           SELECT * FROM case_updated 
//           WHERE 1=0 -- Return empty since no user tracking
//           ORDER BY created_at DESC
//         `;
//         values = [];
//       }
//     } catch (error) {
//       console.error('Error checking columns:', error);
//       // Fallback to trying user_id column
//       query = `
//         SELECT * FROM case_updated 
//         WHERE user_id = $1 
//         ORDER BY created_at DESC
//       `;
//     }

//     const result = await db.query(query, values);
    
//     res.status(200).json({
//       success: true,
//       count: result.rowCount,
//       data: result.rows
//     });
    
//   } catch (error) {
//     console.error('Error fetching user cases:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch user cases',
//       error: error.message
//     });
//   }
// });

// Simple version that definitely works
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
            `SELECT id, current_status FROM case_updated WHERE id = $1`,
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
        if (currentCase.current_status === 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Case is already approved'
            });
        }

        // 2. Update cases table status
        await db.query(
            `UPDATE case_updated SET 
                current_status = 'approved',
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
            `UPDATE cases SET current_status = 'rejected' WHERE id = $1`,
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
             WHERE c.current_status = 'rejected'
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
             SET current_status = 'pending_review' 
             WHERE id = $1 AND current_status = 'rejected'`,
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