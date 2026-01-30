// config/s3.config.js
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
require('dotenv').config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'me-central-1',
  credentials: fromEnv(),
  // For production with IAM roles, remove credentials line
});

module.exports = s3Client;