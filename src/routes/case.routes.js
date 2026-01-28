// src/routes/casesRoutes.js
const express = require('express');
const router = express.Router();
const casesController = require('../controllers/cases.Controller');
const { validateCase, validateCaseStatus } = require('../../validators/caseValidator');
const { authenticate, authorize } = require('../../middleware/auth');

// Public routes
router.get('/statistics', casesController.getCaseStatistics);
router.get('/search/:query', casesController.searchCases);
router.get('/by-email/:email', casesController.getCasesByClientEmail);
router.get('/by-number/:caseNumber', casesController.getCaseByNumber);

// Protected routes (require authentication)
router.use(authenticate);

// CRUD operations
router.post('/', validateCase, casesController.createCase);
router.get('/', casesController.getAllCases);
router.get('/:id', casesController.getCaseById);
router.put('/:id', validateCase, casesController.updateCase);
router.patch('/:id/status', validateCaseStatus, casesController.updateCaseStatus);
router.delete('/:id', casesController.deleteCase);

// Status-based routes
router.get('/status/:status', casesController.getCasesByStatus);

// Document management
router.put('/:id/documents', casesController.updateCaseDocuments);

// Admin-only routes
router.get('/admin/statistics', authorize(['admin', 'supervisor']), casesController.getCaseStatistics);

module.exports = router;