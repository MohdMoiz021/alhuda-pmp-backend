// src/config/constants.js
module.exports = {
  USER_ROLES: {
    ADMIN_A: 'admin_a', // Sub-Consultant
    ADMIN_B: 'admin_b', // Internal Team
    ADMIN_C: 'admin_c'  // Management
  },
  
  CASE_STATUS: {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
    UNDER_REVIEW: 'under_review',
    CLARIFICATION_NEEDED: 'clarification_needed',
    APPROVED: 'approved',
    IN_PROCESS: 'in_process',
    COMPLETED: 'completed',
    CLOSED: 'closed'
  },
  
  PRIORITY_LEVELS: {
    LOW: 'low',
    STANDARD: 'standard',
    HIGH: 'high',
    URGENT: 'urgent'
  },
  
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    SERVER_ERROR: 500
  },
  
  ERROR_MESSAGES: {
    USER_NOT_FOUND: 'User not found',
    INVALID_CREDENTIALS: 'Invalid email or password',
    ACCESS_DENIED: 'Access denied',
    EMAIL_EXISTS: 'Email already registered',
    INVALID_TOKEN: 'Invalid token',
    TOKEN_EXPIRED: 'Token expired',
    SERVER_ERROR: 'Internal server error'
  }
};