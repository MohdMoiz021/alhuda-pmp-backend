// src/utils/validators.js
const { body, validationResult } = require('express-validator');
const { USER_ROLES } = require('../../config/constant');

// Common validation rules
const commonValidationRules = {
  email: body('email')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
    
  password: body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/\d/).withMessage('Password must contain a number')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter'),
    
  firstName: body('first_name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('First name too long'),
    
  lastName: body('last_name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Last name too long'),
    
  phone: body('phone')
    .optional()
    .trim()
    .isMobilePhone().withMessage('Please provide a valid phone number'),
    
  companyName: body('company_name')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Company name too long'),
    
  role: body('role')
    .isIn([USER_ROLES.ADMIN_A, USER_ROLES.ADMIN_B, USER_ROLES.ADMIN_C])
    .withMessage('Invalid role. Must be admin_a, admin_b, or admin_c')
};

// Register validation rules
const registerValidationRules = () => [
  commonValidationRules.email,
  commonValidationRules.password,
  commonValidationRules.firstName,
  commonValidationRules.lastName,
  commonValidationRules.phone,
  commonValidationRules.companyName,
  commonValidationRules.role,
  body('password_confirmation')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    })
];

// Login validation rules
const loginValidationRules = () => [
  commonValidationRules.email,
  body('password').notEmpty().withMessage('Password is required')
];

// Validate function
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));
  
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: extractedErrors
  });
};

module.exports = {
  registerValidationRules,
  loginValidationRules,
  validate,
  commonValidationRules
};