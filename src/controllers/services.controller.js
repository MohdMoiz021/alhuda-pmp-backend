// CRUD for the admin-managed service catalog (services table).
const { pool } = require('../../db');

const toStringArray = (val) => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const rowOut = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  required_docs: r.required_docs || [],
  sub_services: r.sub_services || [],
  is_active: r.is_active,
  sort_order: r.sort_order,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

// GET /api/services?active=true
const listServices = async (req, res) => {
  try {
    const activeOnly = String(req.query.active || '').toLowerCase() === 'true';
    const result = await pool.query(
      `SELECT * FROM services ${activeOnly ? 'WHERE is_active = true' : ''}
       ORDER BY sort_order ASC, description ASC`
    );
    res.json({ success: true, count: result.rows.length, data: result.rows.map(rowOut) });
  } catch (error) {
    console.error('listServices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch services' });
  }
};

// GET /api/services/:id
const getService = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }
    res.json({ success: true, data: rowOut(result.rows[0]) });
  } catch (error) {
    console.error('getService error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch service' });
  }
};

// POST /api/services
const createService = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !description) {
      return res.status(400).json({ success: false, message: 'name and description are required' });
    }
    const slug = String(name).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!slug) {
      return res.status(400).json({ success: false, message: 'name must contain letters or numbers' });
    }

    const required_docs = toStringArray(req.body.required_docs);
    const sub_services = toStringArray(req.body.sub_services);
    const sort_order = Number.isFinite(+req.body.sort_order) ? +req.body.sort_order : 0;
    const is_active = req.body.is_active === undefined ? true : !!req.body.is_active;

    const result = await pool.query(
      `INSERT INTO services (name, description, required_docs, sub_services, is_active, sort_order)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
       RETURNING *`,
      [slug, String(description).trim(), JSON.stringify(required_docs), JSON.stringify(sub_services), is_active, sort_order]
    );
    res.status(201).json({ success: true, message: 'Service created', data: rowOut(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A service with this name already exists' });
    }
    console.error('createService error:', error);
    res.status(500).json({ success: false, message: 'Failed to create service' });
  }
};

// PUT /api/services/:id
const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(String(req.body.description).trim());
    }
    if (req.body.required_docs !== undefined) {
      updates.push(`required_docs = $${i++}::jsonb`);
      values.push(JSON.stringify(toStringArray(req.body.required_docs)));
    }
    if (req.body.sub_services !== undefined) {
      updates.push(`sub_services = $${i++}::jsonb`);
      values.push(JSON.stringify(toStringArray(req.body.sub_services)));
    }
    if (req.body.sort_order !== undefined && Number.isFinite(+req.body.sort_order)) {
      updates.push(`sort_order = $${i++}`);
      values.push(+req.body.sort_order);
    }
    if (req.body.is_active !== undefined) {
      updates.push(`is_active = $${i++}`);
      values.push(!!req.body.is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE services SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ success: true, message: 'Service updated', data: rowOut(result.rows[0]) });
  } catch (error) {
    console.error('updateService error:', error);
    res.status(500).json({ success: false, message: 'Failed to update service' });
  }
};

// PATCH /api/services/:id/status
const updateServiceStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active must be a boolean' });
    }
    const result = await pool.query(
      `UPDATE services SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [is_active, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }
    res.json({
      success: true,
      message: is_active ? 'Service activated' : 'Service deactivated',
      data: rowOut(result.rows[0]),
    });
  } catch (error) {
    console.error('updateServiceStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to update service status' });
  }
};

// DELETE /api/services/:id
const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }
    const svc = existing.rows[0];

    // Block deletion when cases still reference this service (by slug or label).
    const inUse = await pool.query(
      `SELECT 1 FROM case_updated WHERE case_type = $1 OR case_type = $2 LIMIT 1`,
      [svc.name, svc.description]
    );
    if (inUse.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This service is used by existing cases. Deactivate it instead of deleting.',
      });
    }

    await pool.query('DELETE FROM services WHERE id = $1', [id]);
    res.json({ success: true, message: 'Service deleted' });
  } catch (error) {
    console.error('deleteService error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete service' });
  }
};

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  updateServiceStatus,
  deleteService,
};
