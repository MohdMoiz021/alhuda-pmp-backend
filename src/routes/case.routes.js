// src/routes/casesRoutes.js

// Add at the top of your casesRoutes.js or app.js
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
        fieldSize: 10 * 1024 * 1024 // 10MB max field size
    }
});

// In your routes, modify the POST route:

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
// router.use(authenticate);

// CRUD operations
router.post('/', upload.any(), casesController.createCase);
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