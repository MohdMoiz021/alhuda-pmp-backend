// src/services/caseService.js
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

class CaseService {
// services/caseService.js
async createCase(caseData) {
    try {
        console.log('Service received caseData:', caseData);
        
        // Check if caseData exists
        if (!caseData) {
            throw new Error('caseData is undefined');
        }
        
        // Validate required fields
        const requiredFields = ['client_name', 'client_email', 'client_phone', 'company_name', 'service_type', 'deal_value', 'description'];
        for (const field of requiredFields) {
            if (!caseData[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Prepare values with defaults
        const values = [
            // UUID instead of number
            caseData.case_number || '',
            caseData.client_name || '',
            caseData.client_email || '',
            caseData.client_phone || '',
            caseData.company_name || '',
            caseData.company_location || '',
            caseData.established_date || new Date().toISOString().split('T')[0],
            caseData.company_type || '',
            caseData.business_activity || '',
            caseData.company_size || '',
            caseData.service_type || 'account_opening',
            parseFloat(caseData.deal_value) || 1000,
            caseData.deal_value_currency || 'USD',
            caseData.estimated_processing_time || '',
            caseData.preferred_bank || '',
            caseData.description || '',
            caseData.additional_notes || caseData.notes || '',
            parseFloat(caseData.commission_percentage) || 15.00,
            caseData.commission_amount || null,
            caseData.status || 'pending_review',
            caseData.priority || '',
            caseData.source || 'partner_portal',
            caseData.submitted_by,
            caseData.submitted_by || '00000000-0000-0000-0000-000000000000', // created_by
            caseData.submitted_by || '00000000-0000-0000-0000-000000000000'  // updated_by
        ];
        
        console.log('SQL values:', values);

        const query = `
            INSERT INTO cases (
                id, client_name, client_email, client_phone,
                company_name, company_location, established_date,
                company_type, business_activity, company_size,
                service_type, deal_value, deal_value_currency,
                estimated_processing_time, preferred_bank,
                description, additional_notes,
                commission_percentage, commission_amount,
                status, priority, source,
                submitted_by, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                      $11, $12, $13, $14, $15, $16, $17, $18, $19,
                      $20, $21, $22, $23, $24, $25)
            RETURNING *;
        `;
        
        console.log('Executing query...');
        const result = await db.query(query, values);
        console.log('Query result:', result.rows[0]);
        
        return result.rows[0];
        
    } catch (error) {
        console.error('Service error:', error);
        throw error;
    }
}

  async getAllCases(filters) {
    let query = 'SELECT * FROM cases WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) FROM cases WHERE 1=1';
    const values = [];
    let paramCount = 1;

    // Apply filters
    if (filters.status) {
      query += ` AND status = $${paramCount}`;
      countQuery += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    if (filters.service_type) {
      query += ` AND service_type = $${paramCount}`;
      countQuery += ` AND service_type = $${paramCount}`;
      values.push(filters.service_type);
      paramCount++;
    }

    if (filters.priority) {
      query += ` AND priority = $${paramCount}`;
      countQuery += ` AND priority = $${paramCount}`;
      values.push(filters.priority);
      paramCount++;
    }

    if (filters.start_date) {
      query += ` AND submitted_at >= $${paramCount}`;
      countQuery += ` AND submitted_at >= $${paramCount}`;
      values.push(filters.start_date);
      paramCount++;
    }

    if (filters.end_date) {
      query += ` AND submitted_at <= $${paramCount}`;
      countQuery += ` AND submitted_at <= $${paramCount}`;
      values.push(filters.end_date);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (
        client_name ILIKE $${paramCount} OR
        client_email ILIKE $${paramCount} OR
        company_name ILIKE $${paramCount} OR
        case_number ILIKE $${paramCount}
      )`;
      countQuery += ` AND (
        client_name ILIKE $${paramCount} OR
        client_email ILIKE $${paramCount} OR
        company_name ILIKE $${paramCount} OR
        case_number ILIKE $${paramCount}
      )`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    // Get total count
    const countResult = await db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    // Apply sorting
    const validSortColumns = ['submitted_at', 'updated_at', 'deal_value', 'priority', 'status'];
    const sortColumn = validSortColumns.includes(filters.sort_by) 
      ? filters.sort_by 
      : 'submitted_at';
    
    query += ` ORDER BY ${sortColumn} ${filters.sort_order}`;

    // Apply pagination
    const offset = (filters.page - 1) * filters.limit;
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(filters.limit, offset);

    // Execute query
    const result = await db.query(query, values);
    
    return {
      data: result.rows,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / filters.limit)
      }
    };
  }

  async getCaseById(id) {
    const query = 'SELECT * FROM cases WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  async getCaseByNumber(caseNumber) {
    const query = 'SELECT * FROM cases WHERE case_number = $1';
    const result = await db.query(query, [caseNumber]);
    return result.rows[0];
  }

  async updateCase(id, updateData) {
    // Build dynamic update query
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(id);
    
    const query = `
      UPDATE cases 
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  async getCaseStatistics(filters) {
    // Total cases
    const totalQuery = 'SELECT COUNT(*) FROM cases';
    const totalResult = await db.query(totalQuery);
    
    // Cases by status
    const statusQuery = `
      SELECT status, COUNT(*) as count 
      FROM cases 
      GROUP BY status 
      ORDER BY count DESC
    `;
    const statusResult = await db.query(statusQuery);
    
    // Cases by service type
    const serviceQuery = `
      SELECT service_type, COUNT(*) as count 
      FROM cases 
      GROUP BY service_type 
      ORDER BY count DESC
    `;
    const serviceResult = await db.query(serviceQuery);
    
    // Total deal value
    const valueQuery = `
      SELECT 
        SUM(deal_value) as total_deal_value,
        AVG(deal_value) as average_deal_value,
        MIN(deal_value) as min_deal_value,
        MAX(deal_value) as max_deal_value
      FROM cases
      WHERE status NOT IN ('cancelled', 'rejected')
    `;
    const valueResult = await db.query(valueQuery);
    
    // Monthly trend
    const trendQuery = `
      SELECT 
        DATE_TRUNC('month', submitted_at) as month,
        COUNT(*) as case_count,
        SUM(deal_value) as monthly_deal_value
      FROM cases
      WHERE submitted_at >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', submitted_at)
      ORDER BY month DESC
    `;
    const trendResult = await db.query(trendQuery);
    
    return {
      total_cases: parseInt(totalResult.rows[0].count),
      by_status: statusResult.rows,
      by_service_type: serviceResult.rows,
      deal_value_summary: valueResult.rows[0],
      monthly_trend: trendResult.rows
    };
  }

  async getCasesByStatus(status, pagination) {
    const query = `
      SELECT * FROM cases 
      WHERE status = $1 
      ORDER BY submitted_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = 'SELECT COUNT(*) FROM cases WHERE status = $1';
    
    const offset = (pagination.page - 1) * pagination.limit;
    
    const [result, countResult] = await Promise.all([
      db.query(query, [status, pagination.limit, offset]),
      db.query(countQuery, [status])
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
      data: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit)
      }
    };
  }

  async searchCases(query, pagination) {
    const searchQuery = `
      SELECT * FROM cases 
      WHERE 
        client_name ILIKE $1 OR
        client_email ILIKE $1 OR
        company_name ILIKE $1 OR
        case_number ILIKE $1 OR
        description ILIKE $1
      ORDER BY submitted_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) FROM cases 
      WHERE 
        client_name ILIKE $1 OR
        client_email ILIKE $1 OR
        company_name ILIKE $1 OR
        case_number ILIKE $1 OR
        description ILIKE $1
    `;
    
    const searchTerm = `%${query}%`;
    const offset = (pagination.page - 1) * pagination.limit;
    
    const [result, countResult] = await Promise.all([
      db.query(searchQuery, [searchTerm, pagination.limit, offset]),
      db.query(countQuery, [searchTerm])
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
      data: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit)
      }
    };
  }

  async getCasesByClientEmail(email, pagination) {
    const query = `
      SELECT * FROM cases 
      WHERE client_email = $1 
      ORDER BY submitted_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = 'SELECT COUNT(*) FROM cases WHERE client_email = $1';
    
    const offset = (pagination.page - 1) * pagination.limit;
    
    const [result, countResult] = await Promise.all([
      db.query(query, [email, pagination.limit, offset]),
      db.query(countQuery, [email])
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
      data: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit)
      }
    };
  }

  async updateCaseDocuments(caseId, documents, action) {
    // First get current documents
    const getQuery = 'SELECT uploaded_documents FROM cases WHERE id = $1';
    const getResult = await db.query(getQuery, [caseId]);
    
    if (getResult.rows.length === 0) {
      return null;
    }
    
    let currentDocuments = getResult.rows[0].uploaded_documents || [];
    
    // Update documents based on action
    if (action === 'replace') {
      currentDocuments = documents;
    } else if (action === 'add') {
      currentDocuments = [...currentDocuments, ...documents];
    } else if (action === 'remove') {
      const docIdsToRemove = documents.map(doc => doc.id || doc);
      currentDocuments = currentDocuments.filter(doc => 
        !docIdsToRemove.includes(doc.id || doc)
      );
    }
    
    // Update in database
    const updateQuery = `
      UPDATE cases 
      SET uploaded_documents = $1, documents_count = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *;
    `;
    
    const updateResult = await db.query(updateQuery, [
      JSON.stringify(currentDocuments),
      currentDocuments.length,
      caseId
    ]);
    
    return updateResult.rows[0];
  }
}

module.exports = new CaseService();