// middleware/s3Upload.middleware.js
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

// Initialize S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Configure Multer for S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    acl: 'private',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, {
        fieldName: file.fieldname,
        uploadedBy: req.body.submitted_by || 'anonymous',
        caseType: req.body.case_type || 'unknown',
        originalName: file.originalname
      });
    },
    key: function (req, file, cb) {
      const userId = req.body.user_id || 'anonymous';
      const caseId = req.body.case_reference || Date.now().toString();
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `${uuidv4()}${fileExtension}`;
      
      // Organize files by user/case
      const s3Key = `cases/${userId}/${caseId}/documents/${uniqueFilename}`;
      
      // Store file info in request for later use
      if (!req.uploadedFiles) req.uploadedFiles = [];
      req.uploadedFiles.push({
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        s3Key: s3Key,
        bucket: process.env.S3_BUCKET_NAME,
        url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`
      });
      
      cb(null, s3Key);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 files per request
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Allowed: PDF, Images, Word, Excel`));
    }
  }
});

module.exports = upload;