const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// First, update your Multer configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/'); // Make sure this directory exists
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg', 
      'image/png', 
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, and DOC files are allowed.'));
    }
  }
});

// Create middleware for multiple field uploads
const uploadMultipleFields = upload.fields([
  { name: 'documents', maxCount: 1 },
  { name: 'additional_documents', maxCount: 10 }
]);

// Or if you want to keep using upload.array() but fix the error:
const uploadAnyFiles = upload.any(); // This accepts any field name

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// const uploadToS3 = async (req, res, next) => {
//   if (!req.files || req.files.length === 0) {
//     req.uploadedFiles = [];
//     return next();
//   }

//   req.uploadedFiles = [];

//   for (const file of req.files) {
//     const fileStream = fs.createReadStream(file.path);
//     const s3Key = `cases/${Date.now()}-${file.originalname}`;

//     const uploadParams = {
//       Bucket: process.env.S3_BUCKET_NAME,
//       Key: s3Key,
//       Body: fileStream,
//       ContentType: file.mimetype,
//     };

//     await s3.send(new PutObjectCommand(uploadParams));

//     req.uploadedFiles.push({
//       originalName: file.originalname,
//       mimeType: file.mimetype,
//       size: file.size,
//       s3Key,
//       bucket: process.env.S3_BUCKET_NAME,
//       url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
//     });

//     fs.unlinkSync(file.path); // cleanup local file
//   }

//   next();
// };

const uploadToS3 = async (req, res, next) => {
  try {
    // Check if files exist (for upload.fields() approach)
    if (!req.files || (Object.keys(req.files).length === 0 && req.files.constructor === Object)) {
      req.uploadedFiles = [];
      return next();
    }
    
    req.uploadedFiles = [];
    
    // Handle files based on upload method
    
    // If using upload.fields()
    if (req.files['documents'] || req.files['additional_documents']) {
      // Process all files from both fields
      const allFiles = [];
      
      if (req.files['documents']) {
        allFiles.push(...req.files['documents']);
      }
      
      if (req.files['additional_documents']) {
        allFiles.push(...req.files['additional_documents']);
      }
      
      // Upload all files to S3
      for (const file of allFiles) {
        const fileStream = fs.createReadStream(file.path);
        const s3Key = `cases/${Date.now()}-${file.originalname}`;

        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Key,
          Body: fileStream,
          ContentType: file.mimetype,
        };

        await s3.send(new PutObjectCommand(uploadParams));

        req.uploadedFiles.push({
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          s3Key,
          bucket: process.env.S3_BUCKET_NAME,
          url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
          fieldname: file.fieldname // Keep track of which field this came from
        });

        // Cleanup local file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    } 
    // If using upload.array() or upload.any()
    else if (Array.isArray(req.files)) {
      for (const file of req.files) {
        const fileStream = fs.createReadStream(file.path);
        const s3Key = `cases/${Date.now()}-${file.originalname}`;

        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Key,
          Body: fileStream,
          ContentType: file.mimetype,
        };

        await s3.send(new PutObjectCommand(uploadParams));

        req.uploadedFiles.push({
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          s3Key,
          bucket: process.env.S3_BUCKET_NAME,
          url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
          fieldname: file.fieldname
        });

        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('Error uploading to S3:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading files to S3',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  uploadToS3,
};
