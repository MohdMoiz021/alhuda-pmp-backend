// src/validators/caseValidator.js
const Joi = require('joi');

const caseSchema = Joi.object({
  // Client Information
  client_name: Joi.string().min(2).max(255).required(),
  client_email: Joi.string().email().required(),
  client_phone: Joi.string().min(8).max(50).required(),
  
  // Company Information
  company_name: Joi.string().min(2).max(255).required(),
  company_location: Joi.string().min(2).max(255).required(),
  established_date: Joi.date().required(),
  company_type: Joi.string().max(100).optional(),
  business_activity: Joi.string().max(255).optional(),
  company_size: Joi.string().max(100).optional(),
  
  // Case Details
  service_type: Joi.string().valid(
    'account_opening', 'trade_facilities', 'sukuk_funding', 
    'project_funding', 'corporate_loans', 'investment_advisory', 'other'
  ).required(),
  deal_value: Joi.number().min(1000).required(),
  deal_value_currency: Joi.string().length(3).default('USD'),
  estimated_processing_time: Joi.string().max(50).optional(),
  preferred_bank: Joi.string().max(100).optional(),
  description: Joi.string().min(10).required(),
  additional_notes: Joi.string().optional(),
  
  // Commission
  commission_percentage: Joi.number().min(0).max(100).default(15.00),
  commission_amount: Joi.number().min(0).optional(),
  
  // Documents
  required_documents: Joi.array().items(Joi.string()).optional(),
  
  // Priority
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  
  // Source
  source: Joi.string().valid('partner_portal', 'direct', 'referral').default('partner_portal')
});

const caseStatusSchema = Joi.object({
  status: Joi.string().valid(
    'pending_review', 'under_review', 'approved', 'rejected', 
    'in_progress', 'completed', 'cancelled'
  ).required(),
  reviewed_by: Joi.string().uuid().optional()
});

const validateCase = (req, res, next) => {
  const { error } = caseSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

const validateCaseStatus = (req, res, next) => {
  const { error } = caseStatusSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

module.exports = {
  validateCase,
  validateCaseStatus
};