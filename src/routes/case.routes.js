// // src/routes/casesRoutes.js

// // Add at the top of your casesRoutes.js or app.js
// const multer = require('multer');

// // Configure multer for file uploads
// const storage = multer.memoryStorage(); // Store files in memory
// const upload = multer({
//     storage: storage,
//     limits: {
//         fileSize: 10 * 1024 * 1024, // 10MB max file size
//         fieldSize: 10 * 1024 * 1024 // 10MB max field size
//     }
// });

// // In your routes, modify the POST route:

// const express = require('express');
// const router = express.Router();
// const casesController = require('../controllers/cases.Controller');
// const { validateCase, validateCaseStatus } = require('../../validators/caseValidator');
// const { authenticate, authorize } = require('../../middleware/auth');

// // Public routes
// router.get('/statistics', casesController.getCaseStatistics);
// router.get('/search/:query', casesController.searchCases);
// router.get('/by-email/:email', casesController.getCasesByClientEmail);
// router.get('/by-number/:caseNumber', casesController.getCaseByNumber);

// // Protected routes (require authentication)
// // router.use(authenticate);

// // CRUD operations
// router.post('/', upload.any(), casesController.createCase);
// router.get('/', casesController.getAllCases);
// router.get('/:id', casesController.getCaseById);
// router.put('/:id', validateCase, casesController.updateCase);
// router.patch('/:id/status', validateCaseStatus, casesController.updateCaseStatus);
// router.delete('/:id', casesController.deleteCase);

// // Status-based routes
// router.get('/status/:status', casesController.getCasesByStatus);

// // Document management
// router.put('/:id/documents', casesController.updateCaseDocuments);

// // Admin-only routes
// router.get('/admin/statistics', authorize(['admin', 'supervisor']), casesController.getCaseStatistics);

// module.exports = router;


// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const router = express.Router();
// const db = require('../../db');

// // Configure multer for file uploads
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const uploadDir = 'uploads/cases';
//     if (!fs.existsSync(uploadDir)) {
//       fs.mkdirSync(uploadDir, { recursive: true });
//     }
//     cb(null, uploadDir);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });

// const upload = multer({ 
//   storage: storage,
//   limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
//   fileFilter: (req, file, cb) => {
//     const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt/;
//     const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//     const mimetype = allowedTypes.test(file.mimetype);
    
//     if (mimetype && extname) {
//       return cb(null, true);
//     } else {
//       cb(new Error('Only images, PDF, DOC, and TXT files are allowed'));
//     }
//   }
// });

// // Create a new case with file upload support
// router.post('/', upload.array('documents', 5), async (req, res) => {
//   try {
//     // Parse form data (text fields come from req.body with multer)
//     const {
//       client_name,
//       client_email,
//       client_phone,
//       company_name,
//       company_location,
//       established_date,
//       company_type,
//       business_activity,
//       company_size,
//       case_type,
//       deal_value,
//       description,
//       additional_notes,
//       preferred_bank,
//       timeline,
//       expected_closure,
//       deal_structure,
//       total_amount,
//       commission_percentage,
//       commission_amount,
//       processing_fee,
//       processing_time,
//       priority,
//       payment_terms,
//       contact_method,
//       contact_time,
//       language,
//       submitted_by,
//       user_id,
//       partner_name,
//       partner_email,
//       submitted_at,
//       source,
//       commission_rate
//     } = req.body;

//     // Handle uploaded files
//     let document_paths = [];
//     if (req.files && req.files.length > 0) {
//       document_paths = req.files.map(file => file.path);
//     }

//     // Prepare values for database
//     const values = [
//       client_name, client_email, client_phone, company_name,
//       company_location, established_date || null, company_type,
//       business_activity, company_size, case_type, 
//       deal_value ? parseFloat(deal_value) : null,
//       description, additional_notes, preferred_bank, timeline,
//       expected_closure || null, deal_structure,
//       total_amount ? parseFloat(total_amount) : null,
//       commission_percentage ? parseFloat(commission_percentage) : 15.00,
//       commission_amount ? parseFloat(commission_amount) : null,
//       processing_fee ? parseFloat(processing_fee) : null,
//       processing_time, priority, payment_terms,
//       contact_method, contact_time, language,
//       JSON.stringify(document_paths), // Store as JSON array
//       submitted_by, user_id ? parseInt(user_id) : null,
//       partner_name, partner_email,
//       submitted_at || new Date().toISOString(),
//       source, commission_rate ? parseFloat(commission_rate) : null
//     ];

//     // Try to insert with all columns
//     const query = `
//       INSERT INTO case_updated (
//         client_name, client_email, client_phone, company_name,
//         company_location, established_date, company_type,
//         business_activity, company_size, case_type, deal_value,
//         description, additional_notes, preferred_bank, timeline,
//         expected_closure, deal_structure, total_amount,
//         commission_percentage, commission_amount, processing_fee,
//         processing_time, priority, payment_terms,
//         contact_method, contact_time, language,
//         document_paths, submitted_by, user_id,
//         partner_name, partner_email, submitted_at,
//         source, commission_rate
//       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
//         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
//         $27, $28, $29, $30, $31, $32, $33, $34)
//       RETURNING *;
//     `;

//     const result = await db.query(query, values);
    
//     res.status(201).json({
//       success: true,
//       message: 'Case created successfully',
//       data: result.rows[0],
//       files_uploaded: document_paths.length
//     });
    
//   } catch (error) {
//     console.error('Error creating case:', error);
    
//     // If error is due to missing columns, try with basic columns
//     if (error.message.includes('column') && error.message.includes('does not exist')) {
//       try {
//         // Basic insert without new columns
//         const {
//           client_name,
//           client_email,
//           client_phone,
//           company_name,
//           company_location,
//           established_date,
//           company_type,
//           business_activity,
//           company_size,
//           case_type,
//           deal_value,
//           description,
//           additional_notes,
//           preferred_bank,
//           timeline,
//           expected_closure,
//           deal_structure,
//           total_amount,
//           commission_percentage,
//           commission_amount,
//           processing_fee,
//           processing_time,
//           priority,
//           payment_terms
//         } = req.body;

//         const basicQuery = `
//           INSERT INTO case_updated (
//             client_name, client_email, client_phone, company_name,
//             company_location, established_date, company_type,
//             business_activity, company_size, case_type, deal_value,
//             description, additional_notes, preferred_bank, timeline,
//             expected_closure, deal_structure, total_amount,
//             commission_percentage, commission_amount, processing_fee,
//             processing_time, priority, payment_terms
//           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
//             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
//           RETURNING *;
//         `;

//         const basicValues = [
//           client_name, client_email, client_phone, company_name,
//           company_location, established_date || null, company_type,
//           business_activity, company_size, case_type,
//           deal_value ? parseFloat(deal_value) : null,
//           description, additional_notes, preferred_bank, timeline,
//           expected_closure || null, deal_structure,
//           total_amount ? parseFloat(total_amount) : null,
//           commission_percentage ? parseFloat(commission_percentage) : 15.00,
//           commission_amount ? parseFloat(commission_amount) : null,
//           processing_fee ? parseFloat(processing_fee) : null,
//           processing_time, priority, payment_terms
//         ];

//         const result = await db.query(basicQuery, basicValues);
        
//         res.status(201).json({
//           success: true,
//           message: 'Case created successfully (basic version)',
//           data: result.rows[0],
//           note: 'Some fields were not saved due to database schema differences'
//         });
//       } catch (fallbackError) {
//         console.error('Fallback error:', fallbackError);
//         res.status(500).json({
//           success: false,
//           message: 'Failed to create case',
//           error: fallbackError.message
//         });
//       }
//     } else {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to create case',
//         error: error.message
//       });
//     }
//   }
// });

// // Get all cases
// router.get('/', async (req, res) => {
//   try {
//     const query = 'SELECT * FROM case_updated ORDER BY created_at DESC';
//     const result = await db.query(query);
    
//     res.status(200).json({
//       success: true,
//       count: result.rowCount,
//       data: result.rows
//     });
//   } catch (error) {
//     console.error('Error fetching cases:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch cases',
//       error: error.message
//     });
//   }
// });

// // Get single case by ID
// router.get('/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const query = 'SELECT * FROM case_updated WHERE id = $1';
//     const result = await db.query(query, [id]);
    
//     if (result.rowCount === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Case not found'
//       });
//     }
    
//     res.status(200).json({
//       success: true,
//       data: result.rows[0]
//     });
//   } catch (error) {
//     console.error('Error fetching case:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch case',
//       error: error.message
//     });
//   }
// });

// // Update a case with optional file upload
// router.put('/:id', upload.array('documents', 5), async (req, res) => {
//   try {
//     const { id } = req.params;
//     const updateFields = req.body;
    
//     // Check if case exists
//     const checkQuery = 'SELECT * FROM case_updated WHERE id = $1';
//     const checkResult = await db.query(checkQuery, [id]);
    
//     if (checkResult.rowCount === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Case not found'
//       });
//     }
    
//     // Handle new file uploads
//     let new_documents = [];
//     if (req.files && req.files.length > 0) {
//       new_documents = req.files.map(file => file.path);
      
//       // Get existing documents and merge with new ones
//       const existingCase = checkResult.rows[0];
//       let existingDocuments = [];
      
//       if (existingCase.document_paths) {
//         try {
//           existingDocuments = JSON.parse(existingCase.document_paths);
//         } catch (e) {
//           existingDocuments = existingCase.document_paths || [];
//         }
//       }
      
//       const mergedDocuments = [...existingDocuments, ...new_documents];
//       updateFields.document_paths = JSON.stringify(mergedDocuments);
//     }
    
//     // Build dynamic update query
//     const setClauses = [];
//     const values = [];
//     let paramCount = 1;
    
//     for (const [key, value] of Object.entries(updateFields)) {
//       // Skip id, created_at, and updated_at from manual updates
//       if (key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
//         // Parse numeric fields
//         let processedValue = value;
//         if (['deal_value', 'total_amount', 'commission_percentage', 
//              'commission_amount', 'processing_fee', 'commission_rate'].includes(key)) {
//           processedValue = value ? parseFloat(value) : null;
//         } else if (key === 'user_id') {
//           processedValue = value ? parseInt(value) : null;
//         }
        
//         setClauses.push(`${key} = $${paramCount}`);
//         values.push(processedValue);
//         paramCount++;
//       }
//     }
    
//     // Add updated_at timestamp
//     setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    
//     values.push(id); // Add id for WHERE clause
    
//     const query = `
//       UPDATE case_updated 
//       SET ${setClauses.join(', ')}
//       WHERE id = $${paramCount}
//       RETURNING *;
//     `;
    
//     const result = await db.query(query, values);
    
//     res.status(200).json({
//       success: true,
//       message: 'Case updated successfully',
//       data: result.rows[0],
//       files_uploaded: new_documents.length
//     });
//   } catch (error) {
//     console.error('Error updating case:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update case',
//       error: error.message
//     });
//   }
// });

// // Delete a case
// router.delete('/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     // First get the case to delete associated files
//     const getQuery = 'SELECT document_paths FROM case_updated WHERE id = $1';
//     const getResult = await db.query(getQuery, [id]);
    
//     if (getResult.rowCount === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Case not found'
//       });
//     }
    
//     // Delete associated files
//     const caseData = getResult.rows[0];
//     if (caseData.document_paths) {
//       try {
//         const documentPaths = JSON.parse(caseData.document_paths);
//         documentPaths.forEach(filePath => {
//           if (fs.existsSync(filePath)) {
//             fs.unlinkSync(filePath);
//           }
//         });
//       } catch (e) {
//         console.log('Error deleting files:', e.message);
//       }
//     }
    
//     // Delete from database
//     const deleteQuery = 'DELETE FROM case_updated WHERE id = $1 RETURNING *';
//     const result = await db.query(deleteQuery, [id]);
    
//     res.status(200).json({
//       success: true,
//       message: 'Case deleted successfully',
//       data: result.rows[0]
//     });
//   } catch (error) {
//     console.error('Error deleting case:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete case',
//       error: error.message
//     });
//   }
// });

// // Search cases
// router.get('/search', async (req, res) => {
//   try {
//     const { email, company, case_type, status } = req.query;
    
//     let query = 'SELECT * FROM case_updated WHERE 1=1';
//     const values = [];
//     let paramCount = 1;
    
//     if (email) {
//       query += ` AND client_email ILIKE $${paramCount}`;
//       values.push(`%${email}%`);
//       paramCount++;
//     }
    
//     if (company) {
//       query += ` AND company_name ILIKE $${paramCount}`;
//       values.push(`%${company}%`);
//       paramCount++;
//     }
    
//     if (case_type) {
//       query += ` AND case_type = $${paramCount}`;
//       values.push(case_type);
//       paramCount++;
//     }
    
//     if (status) {
//       query += ` AND status = $${paramCount}`;
//       values.push(status);
//     }
    
//     query += ' ORDER BY created_at DESC';
    
//     const result = await db.query(query, values);
    
//     res.status(200).json({
//       success: true,
//       count: result.rowCount,
//       data: result.rows
//     });
//   } catch (error) {
//     console.error('Error searching cases:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to search cases',
//       error: error.message
//     });
//   }
// });

// // Download a document
// router.get('/download/:caseId/:filename', async (req, res) => {
//   try {
//     const { caseId, filename } = req.params;
    
//     // Verify the case exists and has this document
//     const query = 'SELECT document_paths FROM case_updated WHERE id = $1';
//     const result = await db.query(query, [caseId]);
    
//     if (result.rowCount === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Case not found'
//       });
//     }
    
//     const caseData = result.rows[0];
//     let documentPaths = [];
    
//     if (caseData.document_paths) {
//       try {
//         documentPaths = JSON.parse(caseData.document_paths);
//       } catch (e) {
//         documentPaths = caseData.document_paths || [];
//       }
//     }
    
//     // Find the requested file
//     const filePath = documentPaths.find(path => path.includes(filename));
    
//     if (!filePath || !fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }
    
//     res.download(filePath);
    
//   } catch (error) {
//     console.error('Error downloading file:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to download file',
//       error: error.message
//     });
//   }
// });

// module.exports = router;


const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../../db');

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

// Use .any() to accept all files regardless of field name
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST endpoint - Create a new case
router.post('/', upload.any(), async (req, res) => {
  try {
    console.log('Files received:', req.files?.length || 0);
    console.log('Body fields:', Object.keys(req.body).length);

    // All form fields are in req.body (multer puts them there)
    const formData = req.body;
    
    // Handle uploaded files
    let document_paths = [];
    if (req.files && req.files.length > 0) {
      document_paths = req.files.map(file => file.path);
      console.log('Document paths:', document_paths);
    }

    // Extract all fields with default values
    const {
      client_name = '',
      client_email = '',
      client_phone = '',
      company_name = '',
      company_location = '',
      established_date = null,
      company_type = '',
      business_activity = '',
      company_size = '',
      case_type = '',
      deal_value = null,
      description = '',
      additional_notes = '',
      preferred_bank = '',
      timeline = '',
      expected_closure = null,
      deal_structure = '',
      total_amount = null,
      commission_percentage = 15.00,
      commission_amount = null,
      processing_fee = null,
      processing_time = '',
      priority = '',
      payment_terms = '',
      contact_method = '',
      contact_time = '',
      language = '',
      submitted_by = '',
      user_id = null,
      partner_name = '',
      partner_email = '',
      submitted_at = new Date().toISOString(),
      source = '',
      commission_rate = null
    } = formData;

    // Parse numeric values
    const parsedDealValue = deal_value ? parseFloat(deal_value) : null;
    const parsedTotalAmount = total_amount ? parseFloat(total_amount) : null;
    const parsedCommissionPercentage = commission_percentage ? parseFloat(commission_percentage) : 15.00;
    const parsedCommissionAmount = commission_amount ? parseFloat(commission_amount) : null;
    const parsedProcessingFee = processing_fee ? parseFloat(processing_fee) : null;
    const parsedUserId = user_id ? parseInt(user_id) : null;
    const parsedCommissionRate = commission_rate ? parseFloat(commission_rate) : null;

    // Check if we have the extended columns in the database
    // Try the extended insert first
    try {
      const query = `
        INSERT INTO case_updated (
          client_name, client_email, client_phone, company_name,
          company_location, established_date, company_type,
          business_activity, company_size, case_type, deal_value,
          description, additional_notes, preferred_bank, timeline,
          expected_closure, deal_structure, total_amount,
          commission_percentage, commission_amount, processing_fee,
          processing_time, priority, payment_terms,
          contact_method, contact_time, language,
          document_paths, submitted_by, user_id,
          partner_name, partner_email, submitted_at,
          source, commission_rate, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
        RETURNING *;
      `;

      const values = [
        client_name, client_email, client_phone, company_name,
        company_location, established_date || null, company_type,
        business_activity, company_size, case_type, 
        parsedDealValue, description, additional_notes, preferred_bank, 
        timeline, expected_closure || null, deal_structure,
        parsedTotalAmount, parsedCommissionPercentage, parsedCommissionAmount, 
        parsedProcessingFee, processing_time, priority, payment_terms,
        contact_method, contact_time, language,
        JSON.stringify(document_paths), submitted_by, parsedUserId,
        partner_name || null, partner_email || null, submitted_at,
        source, parsedCommissionRate,
        new Date().toISOString(), // created_at
        new Date().toISOString()  // updated_at
      ];

      const result = await db.query(query, values);
      
      res.status(201).json({
        success: true,
        message: 'Case created successfully',
        data: result.rows[0],
        files_uploaded: document_paths.length
      });

    } catch (dbError) {
      // If extended insert fails, try basic insert
      console.log('Extended insert failed, trying basic:', dbError.message);
      
      const basicQuery = `
        INSERT INTO case_updated (
          client_name, client_email, client_phone, company_name,
          company_location, established_date, company_type,
          business_activity, company_size, case_type, deal_value,
          description, additional_notes, preferred_bank, timeline,
          expected_closure, deal_structure, total_amount,
          commission_percentage, commission_amount, processing_fee,
          processing_time, priority, payment_terms,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        RETURNING *;
      `;

      const basicValues = [
        client_name, client_email, client_phone, company_name,
        company_location, established_date || null, company_type,
        business_activity, company_size, case_type, 
        parsedDealValue, description, additional_notes, preferred_bank, 
        timeline, expected_closure || null, deal_structure,
        parsedTotalAmount, parsedCommissionPercentage, parsedCommissionAmount, 
        parsedProcessingFee, processing_time, priority, payment_terms,
        new Date().toISOString(), // created_at
        new Date().toISOString()  // updated_at
      ];

      const result = await db.query(basicQuery, basicValues);
      
      // Store extra fields in additional_notes if needed
      const extraFields = {
        contact_method,
        contact_time,
        language,
        document_paths,
        submitted_by,
        user_id: parsedUserId,
        partner_name,
        partner_email,
        submitted_at,
        source,
        commission_rate: parsedCommissionRate
      };
      
      // Update the record with extra info in additional_notes
      if (Object.values(extraFields).some(val => val !== null && val !== '')) {
        const extraNotes = `\n\nAdditional Data: ${JSON.stringify(extraFields, null, 2)}`;
        const updateQuery = `
          UPDATE case_updated 
          SET additional_notes = COALESCE(additional_notes, '') || $1
          WHERE id = $2
        `;
        await db.query(updateQuery, [extraNotes, result.rows[0].id]);
      }

      res.status(201).json({
        success: true,
        message: 'Case created successfully (using basic columns)',
        data: result.rows[0],
        extra_data_stored: extraFields,
        files_uploaded: document_paths.length
      });
    }

  } catch (error) {
    console.error('Error creating case:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create case',
      error: error.message,
      received_body_keys: Object.keys(req.body || {})
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