const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const upload = multer({ dest: 'uploads/' });

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const uploadToS3 = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    req.uploadedFiles = [];
    return next();
  }

  req.uploadedFiles = [];

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
    });

    fs.unlinkSync(file.path); // cleanup local file
  }

  next();
};

module.exports = {
  upload,
  uploadToS3,
};
