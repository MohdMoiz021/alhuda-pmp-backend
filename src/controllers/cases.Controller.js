// src/controllers/casesController.js
const db = require('../../db');
const caseService = require('../../services/caseService');

class CasesController {
  // Create a new case
  async createCase(req, res, next) {
    try {
      const caseData = req.body;
      
      // Add submitted_by from authenticated user
      caseData.submitted_by = req.user?.id || null;
      
      const newCase = await caseService.createCase(caseData);
      
      res.status(201).json({
        success: true,
        message: 'Case created successfully',
        data: newCase
      });
    } catch (error) {
      next(error);
    }
  }

  // Get all cases with pagination and filtering
  async getAllCases(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        service_type,
        priority,
        start_date,
        end_date,
        search,
        sort_by = 'submitted_at',
        sort_order = 'desc'
      } = req.query;

      const filters = {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        service_type,
        priority,
        start_date,
        end_date,
        search,
        sort_by,
        sort_order: sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc'
      };

      const result = await caseService.getAllCases(filters);
      
      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      next(error);
    }
  }

  // Get single case by ID
  async getCaseById(req, res, next) {
    try {
      const { id } = req.params;
      const caseData = await caseService.getCaseById(id);
      
      if (!caseData) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        data: caseData
      });
    } catch (error) {
      next(error);
    }
  }

  // Get case by case number
  async getCaseByNumber(req, res, next) {
    try {
      const { caseNumber } = req.params;
      const caseData = await caseService.getCaseByNumber(caseNumber);
      
      if (!caseData) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        data: caseData
      });
    } catch (error) {
      next(error);
    }
  }

  // Update case
  async updateCase(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      // Add updated_by from authenticated user
      updateData.updated_by = req.user?.id || null;
      
      const updatedCase = await caseService.updateCase(id, updateData);
      
      if (!updatedCase) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Case updated successfully',
        data: updatedCase
      });
    } catch (error) {
      next(error);
    }
  }

  // Update case status
  async updateCaseStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status, reviewed_by } = req.body;
      
      const updateData = {
        status,
        reviewed_by: reviewed_by || req.user?.id,
        reviewed_at: status === 'approved' || status === 'rejected' ? new Date() : null
      };

      const updatedCase = await caseService.updateCase(id, updateData);
      
      if (!updatedCase) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Case status updated successfully',
        data: updatedCase
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete case (soft delete - update status to cancelled)
  async deleteCase(req, res, next) {
    try {
      const { id } = req.params;
      
      const deletedCase = await caseService.updateCase(id, {
        status: 'cancelled',
        updated_by: req.user?.id
      });
      
      if (!deletedCase) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Case cancelled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Get case statistics
  async getCaseStatistics(req, res, next) {
    try {
      const { start_date, end_date } = req.query;
      
      const statistics = await caseService.getCaseStatistics({
        start_date,
        end_date
      });

      res.status(200).json({
        success: true,
        data: statistics
      });
    } catch (error) {
      next(error);
    }
  }

  // Get cases by status
  async getCasesByStatus(req, res, next) {
    try {
      const { status } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const cases = await caseService.getCasesByStatus(status, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.status(200).json({
        success: true,
        ...cases
      });
    } catch (error) {
      next(error);
    }
  }

  // Search cases
  async searchCases(req, res, next) {
    try {
      const { query } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const results = await caseService.searchCases(query, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.status(200).json({
        success: true,
        ...results
      });
    } catch (error) {
      next(error);
    }
  }

  // Get cases by client email
  async getCasesByClientEmail(req, res, next) {
    try {
      const { email } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const cases = await caseService.getCasesByClientEmail(email, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.status(200).json({
        success: true,
        ...cases
      });
    } catch (error) {
      next(error);
    }
  }

  // Update documents for a case
  async updateCaseDocuments(req, res, next) {
    try {
      const { id } = req.params;
      const { documents, action = 'add' } = req.body;
      
      if (!documents || !Array.isArray(documents)) {
        return res.status(400).json({
          success: false,
          message: 'Documents array is required'
        });
      }

      const updatedCase = await caseService.updateCaseDocuments(id, documents, action);
      
      if (!updatedCase) {
        return res.status(404).json({
          success: false,
          message: 'Case not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Documents updated successfully',
        data: updatedCase
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CasesController();