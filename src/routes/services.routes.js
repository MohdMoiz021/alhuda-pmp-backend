const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const {
  listServices,
  getService,
  createService,
  updateService,
  updateServiceStatus,
  deleteService,
} = require('../controllers/services.controller');

const router = express.Router();

// Public read so the case forms can populate the service dropdown.
router.get('/', listServices);

// Everything below requires a valid session.
router.get('/:id', authenticate, getService);
router.post('/', authenticate, authorize('admin_b', 'admin_c'), createService);
router.put('/:id', authenticate, authorize('admin_b', 'admin_c'), updateService);
router.patch('/:id/status', authenticate, authorize('admin_b', 'admin_c'), updateServiceStatus);
router.delete('/:id', authenticate, authorize('admin_c'), deleteService);

module.exports = router;
