const express = require('express');
const router = express.Router();
const db = require('../../db');

// Authentication middleware (make sure this is properly defined)
const authenticate = async (req, res, next) => {
  try {
    // Add your authentication logic here
    // This is a placeholder - replace with your actual auth middleware
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    // Verify token and set req.user
    // Example:
    // const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // req.user = decoded;
    
    // For now, let's pass through (but you should implement proper auth)
    req.user = { id: 1, role: 'admin' }; // Placeholder
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// ======================================
// TEAM MEMBERS STATISTICS APIS
// ======================================

/**
 * GET /api/team/stats
 * Get overall team statistics
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const { period = 'month' } = req.query;

    let dateFilter = '';
    if (period === 'week') {
      dateFilter = "AND cu.created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "AND cu.created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === 'year') {
      dateFilter = "AND cu.created_at >= NOW() - INTERVAL '1 year'";
    }

    const performanceQuery = `
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.role,
        COUNT(cu.id) as cases_handled,
        COUNT(CASE WHEN cu.current_status = 'approved' THEN 1 END) as completed,
        COUNT(CASE WHEN cu.current_status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN cu.priority = 'urgent' THEN 1 END) as urgent_handled,
        AVG(EXTRACT(EPOCH FROM (cu.updated_at - cu.created_at))/3600)::numeric(10,2) as avg_processing_time,
        MAX(cu.updated_at) as last_action
      FROM users u
      LEFT JOIN case_updated cu ON u.id = cu.assigned_to ${dateFilter}
      WHERE u.role IN ('consultant', 'analyst', 'manager', 'admin_b')
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.role
      ORDER BY completed DESC, cases_handled DESC
    `;

    const result = await db.query(performanceQuery);

    res.json({
      success: true,
      period: period,
      performance: result.rows.map(row => ({
        id: row.id,
        name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
        email: row.email,
        role: row.role,
        casesHandled: parseInt(row.cases_handled) || 0,
        completed: parseInt(row.completed) || 0,
        rejected: parseInt(row.rejected) || 0,
        urgentHandled: parseInt(row.urgent_handled) || 0,
        avgProcessingTime: row.avg_processing_time || 0,
        lastAction: row.last_action,
        successRate: row.cases_handled > 0 
          ? Math.round((row.completed / row.cases_handled) * 100) 
          : 0
      }))
    });

  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance metrics',
      error: error.message
    });
  }
});

/**
 * GET /api/team/members
 * Get all team members with their case statistics
 */
router.get('/members', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const { role, status, search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.role,
        u.is_active,
        u.created_at as join_date,
        COALESCE(case_stats.total_assigned, 0) as assigned_cases,
        COALESCE(case_stats.completed, 0) as completed_cases,
        COALESCE(case_stats.pending, 0) as pending_cases,
        COALESCE(case_stats.urgent, 0) as urgent_cases,
        COALESCE(case_stats.in_progress, 0) as in_progress_cases
      FROM users u
      LEFT JOIN (
        SELECT 
          assigned_to,
          COUNT(*) as total_assigned,
          COUNT(CASE WHEN current_status = 'approved' THEN 1 END) as completed,
          COUNT(CASE WHEN current_status IN ('pending', 'submitted', 'in_progress', 'under_review') THEN 1 END) as pending,
          COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent,
          COUNT(CASE WHEN current_status = 'in_progress' THEN 1 END) as in_progress
        FROM case_updated
        WHERE assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) case_stats ON u.id = case_stats.assigned_to
      WHERE u.role IN ('consultant', 'analyst', 'manager', 'admin_b')
    `;

    const queryParams = [];
    let paramIndex = 1;

    if (role && role !== 'all') {
      query += ` AND u.role = $${paramIndex}`;
      queryParams.push(role);
      paramIndex++;
    }

    if (status && status !== 'all') {
      if (status === 'active') {
        query += ` AND u.is_active = true`;
      } else if (status === 'inactive') {
        query += ` AND u.is_active = false`;
      }
    }

    if (search) {
      query += ` AND (
        u.first_name ILIKE $${paramIndex} OR 
        u.last_name ILIKE $${paramIndex} OR 
        u.email ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY u.first_name ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, queryParams);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) FROM users 
      WHERE role IN ('consultant', 'analyst', 'manager', 'admin_b')
    `;
    const countResult = await db.query(countQuery);

    // Format the response
    const members = result.rows.map(member => ({
      id: member.id,
      name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email,
      email: member.email,
      role: member.role,
      phone: member.phone,
      assignedCases: parseInt(member.assigned_cases),
      completedCases: parseInt(member.completed_cases),
      pendingCases: parseInt(member.pending_cases),
      urgentCases: parseInt(member.urgent_cases),
      inProgressCases: parseInt(member.in_progress_cases),
      joinDate: member.join_date,
      lastActive: member.last_active,
      status: member.is_active ? 
        (member.in_progress_cases > 3 ? 'busy' : 'active') : 
        'offline'
    }));

    res.json({
      success: true,
      members: members,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team members',
      error: error.message
    });
  }
});

/**
 * GET /api/team/members/:memberId
 * Get detailed information for a specific team member
 */
router.get('/members/:memberId', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    const { memberId } = req.params;

    if (!isAdmin && req.user.id !== parseInt(memberId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own profile.'
      });
    }

    // Get member details
    const memberQuery = `
      SELECT 
        id,
        email,
        first_name,
        last_name,
        phone,
        role,
        is_active,
        created_at as join_date,
        avatar_url
      FROM users
      WHERE id = $1
    `;

    const memberResult = await db.query(memberQuery, [memberId]);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found'
      });
    }

    const member = memberResult.rows[0];

    // Get case statistics for this member
    const caseStatsQuery = `
      SELECT 
        COUNT(*) as total_assigned,
        COUNT(CASE WHEN current_status = 'approved' THEN 1 END) as completed,
        COUNT(CASE WHEN current_status IN ('pending', 'submitted', 'in_progress', 'under_review') THEN 1 END) as pending,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent,
        COUNT(CASE WHEN current_status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN current_status = 'rejected' THEN 1 END) as rejected,
        MAX(updated_at) as last_case_activity,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600)::numeric(10,2) as avg_completion_time
      FROM case_updated
      WHERE assigned_to = $1
    `;

    const caseStats = await db.query(caseStatsQuery, [memberId]);

    // Get recent cases assigned to this member
    const recentCasesQuery = `
      SELECT 
        id,
        case_reference,
        partner_name,
        case_type,
        priority,
        current_status as status,
        created_at,
        updated_at
      FROM case_updated
      WHERE assigned_to = $1
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    const recentCases = await db.query(recentCasesQuery, [memberId]);

    res.json({
      success: true,
      member: {
        id: member.id,
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email,
        email: member.email,
        firstName: member.first_name,
        lastName: member.last_name,
        phone: member.phone,
        role: member.role,
        isActive: member.is_active,
        joinDate: member.join_date,
        lastActive: member.last_active,
        avatar: member.avatar_url,
        stats: {
          totalAssigned: parseInt(caseStats.rows[0]?.total_assigned) || 0,
          completed: parseInt(caseStats.rows[0]?.completed) || 0,
          pending: parseInt(caseStats.rows[0]?.pending) || 0,
          urgent: parseInt(caseStats.rows[0]?.urgent) || 0,
          inProgress: parseInt(caseStats.rows[0]?.in_progress) || 0,
          rejected: parseInt(caseStats.rows[0]?.rejected) || 0,
          avgCompletionTime: caseStats.rows[0]?.avg_completion_time || 0,
          lastCaseActivity: caseStats.rows[0]?.last_case_activity
        },
        recentCases: recentCases.rows
      }
    });

  } catch (error) {
    console.error('Error fetching member details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member details',
      error: error.message
    });
  }
});

/**
 * GET /api/team/performance
 * Get team performance metrics
 */
router.get('/performance', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const { period = 'month' } = req.query;

    let dateFilter = '';
    if (period === 'week') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === 'year') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '1 year'";
    }

    const performanceQuery = `
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.role,
        COUNT(c.id) as cases_handled,
        COUNT(CASE WHEN c.current_status = 'approved' THEN 1 END) as completed,
        COUNT(CASE WHEN c.current_status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN c.priority = 'urgent' THEN 1 END) as urgent_handled,
        AVG(EXTRACT(EPOCH FROM (c.updated_at - c.created_at))/3600)::numeric(10,2) as avg_processing_time,
        MAX(c.updated_at) as last_action
      FROM users u
      LEFT JOIN case_updated c ON u.id = c.assigned_to ${dateFilter}
      WHERE u.role IN ('consultant', 'analyst', 'manager', 'admin_b')
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.role
      ORDER BY completed DESC, cases_handled DESC
    `;

    const result = await db.query(performanceQuery);

    res.json({
      success: true,
      period: period,
      performance: result.rows.map(row => ({
        id: row.id,
        name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
        email: row.email,
        role: row.role,
        casesHandled: parseInt(row.cases_handled) || 0,
        completed: parseInt(row.completed) || 0,
        rejected: parseInt(row.rejected) || 0,
        urgentHandled: parseInt(row.urgent_handled) || 0,
        avgProcessingTime: row.avg_processing_time || 0,
        lastAction: row.last_action,
        successRate: row.cases_handled > 0 
          ? Math.round((row.completed / row.cases_handled) * 100) 
          : 0
      }))
    });

  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance metrics',
      error: error.message
    });
  }
});

/**
 * GET /api/team/dashboard
 * Get comprehensive dashboard data for team management
 */
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    // Get quick stats
    const quickStatsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role IN ('consultant', 'analyst', 'manager', 'admin_b')) as total_members,
        (SELECT COUNT(*) FROM users WHERE role IN ('consultant', 'analyst', 'manager', 'admin_b') AND is_active = true) as active_members,
        (SELECT COUNT(*) FROM case_updated WHERE assigned_to IS NOT NULL) as assigned_cases,
        (SELECT COUNT(*) FROM case_updated WHERE assigned_to IS NOT NULL AND current_status = 'approved') as completed_cases,
        (SELECT COUNT(*) FROM case_updated WHERE assigned_to IS NOT NULL AND priority = 'urgent') as urgent_cases
    `;

    const quickStats = await db.query(quickStatsQuery);

    // Get workload distribution
    const workloadQuery = `
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.role,
        COUNT(c.id) as current_load,
        COUNT(CASE WHEN c.priority = 'urgent' THEN 1 END) as urgent_load,
        COUNT(CASE WHEN c.current_status = 'in_progress' THEN 1 END) as in_progress
      FROM users u
      LEFT JOIN case_updated c ON u.id = c.assigned_to 
        AND c.current_status NOT IN ('approved', 'rejected')
      WHERE u.role IN ('consultant', 'analyst', 'manager', 'admin_b')
      GROUP BY u.id, u.first_name, u.last_name, u.role
      ORDER BY current_load DESC
    `;

    const workload = await db.query(workloadQuery);

    // Get recent activity
    const recentActivityQuery = `
      SELECT 
        c.id,
        c.case_reference,
        c.partner_name,
        c.current_status,
        c.updated_at,
        u.first_name as assigned_to_name,
        u.last_name as assigned_to_last
      FROM case_updated c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.assigned_to IS NOT NULL
      ORDER BY c.updated_at DESC
      LIMIT 10
    `;

    const recentActivity = await db.query(recentActivityQuery);

    res.json({
      success: true,
      dashboard: {
        quickStats: quickStats.rows[0],
        workload: workload.rows.map(w => ({
          id: w.id,
          name: `${w.first_name || ''} ${w.last_name || ''}`.trim(),
          role: w.role,
          currentLoad: parseInt(w.current_load) || 0,
          urgentLoad: parseInt(w.urgent_load) || 0,
          inProgress: parseInt(w.in_progress) || 0
        })),
        recentActivity: recentActivity.rows.map(a => ({
          id: a.id,
          caseReference: a.case_reference,
          partnerName: a.partner_name,
          status: a.current_status,
          updatedAt: a.updated_at,
          assignedTo: a.assigned_to_name ? 
            `${a.assigned_to_name} ${a.assigned_to_last || ''}`.trim() : 
            'Unassigned'
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
});

module.exports = router;