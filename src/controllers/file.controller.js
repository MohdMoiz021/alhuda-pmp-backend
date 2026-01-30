// controllers/file.controller.js
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3.config');
const db = require('../config/database'); // Your database connection
require('dotenv').config();

class FileController {
  
  // 1. Upload single file
  static async uploadFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Save file metadata to database
      const fileRecord = await db.query(
        `INSERT INTO user_files 
         (user_id, file_name, file_type, file_size, s3_bucket, s3_key, category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id, created_at`,
        [
          req.fileInfo.userId,
          req.fileInfo.originalName,
          req.fileInfo.mimeType,
          req.fileInfo.size,
          process.env.S3_BUCKET_NAME,
          req.fileInfo.s3Key,
          req.fileInfo.folder
        ]
      );

      // Generate a presigned URL for immediate access
      const presignedUrl = await this.generatePresignedUrl(req.fileInfo.s3Key);

      res.status(201).json({
        message: 'File uploaded successfully',
        file: {
          id: fileRecord.rows[0].id,
          name: req.fileInfo.originalName,
          type: req.fileInfo.mimeType,
          size: req.fileInfo.size,
          url: presignedUrl,
          s3Key: req.fileInfo.s3Key,
          uploadedAt: fileRecord.rows[0].created_at
        }
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to upload file', details: error.message });
    }
  }

  // 2. Generate presigned URL for secure access
  static async generatePresignedUrl(s3Key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw error;
    }
  }

  // 3. Get user's files with presigned URLs
  static async getUserFiles(req, res) {
    try {
      const userId = req.user?.id || req.params.userId;
      const { page = 1, limit = 20 } = req.query;

      // Get files from database
      const result = await db.query(
        `SELECT * FROM user_files 
         WHERE user_id = $1 
         ORDER BY upload_date DESC 
         LIMIT $2 OFFSET $3`,
        [userId, parseInt(limit), (parseInt(page) - 1) * parseInt(limit)]
      );

      // Generate presigned URLs for each file
      const filesWithUrls = await Promise.all(
        result.rows.map(async (file) => {
          const url = await this.generatePresignedUrl(file.s3_key, 3600); // 1 hour expiry
          return {
            ...file,
            url,
            // Don't expose sensitive data
            s3_key: undefined
          };
        })
      );

      res.json({
        files: filesWithUrls,
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.rowCount
      });
    } catch (error) {
      console.error('Error getting user files:', error);
      res.status(500).json({ error: 'Failed to fetch files' });
    }
  }

  // 4. Delete file
  static async deleteFile(req, res) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.id;

      // Get file info from database
      const fileResult = await db.query(
        'SELECT * FROM user_files WHERE id = $1 AND user_id = $2',
        [fileId, userId]
      );

      if (fileResult.rowCount === 0) {
        return res.status(404).json({ error: 'File not found or unauthorized' });
      }

      const file = fileResult.rows[0];

      // Delete from S3
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: file.s3_key
      });
      await s3Client.send(deleteCommand);

      // Delete from database
      await db.query('DELETE FROM user_files WHERE id = $1', [fileId]);

      res.json({ 
        message: 'File deleted successfully',
        deletedFile: {
          id: file.id,
          name: file.file_name
        }
      });
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }

  // 5. Direct upload (frontend uploads directly to S3)
  static async getUploadURL(req, res) {
    try {
      const { fileName, fileType } = req.body;
      const userId = req.user?.id || 'anonymous';
      const fileExtension = fileName.split('.').pop();
      const uniqueKey = `users/${userId}/uploads/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExtension}`;

      // Generate presigned POST URL for direct browser upload
      const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
      const { S3Client } = require('@aws-sdk/client-s3');
      
      const client = new S3Client({ region: process.env.AWS_REGION });
      
      const { url, fields } = await createPresignedPost(client, {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: uniqueKey,
        Conditions: [
          ['content-length-range', 0, parseInt(process.env.MAX_FILE_SIZE) || 10485760],
          ['starts-with', '$Content-Type', fileType],
        ],
        Fields: {
          'Content-Type': fileType,
        },
        Expires: 600, // URL expires in 10 minutes
      });

      res.json({
        uploadURL: url,
        fields: {
          ...fields,
          'key': uniqueKey,
          'Content-Type': fileType
        },
        uniqueKey,
        method: 'POST'
      });
    } catch (error) {
      console.error('Error generating upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  }

  // 6. File info endpoint
  static async getFileInfo(req, res) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.id;

      const result = await db.query(
        'SELECT * FROM user_files WHERE id = $1 AND user_id = $2',
        [fileId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const file = result.rows[0];
      const url = await this.generatePresignedUrl(file.s3_key, 3600);

      res.json({
        ...file,
        url,
        s3_key: undefined // Hide S3 key
      });
    } catch (error) {
      console.error('Error getting file info:', error);
      res.status(500).json({ error: 'Failed to get file info' });
    }
  }
}

module.exports = FileController;