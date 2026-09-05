// Idempotent schema bootstrap.
// Runs on server start. Every statement is safe to run repeatedly.
const { pool } = require('../../db');

const DEFAULT_SERVICES = [
  {
    name: 'account_opening',
    description: 'Business Account Opening',
    required_docs: ['Business License', 'ID Proof', 'Address Proof'],
    sub_services: [],
    sort_order: 1,
  },
  {
    name: 'trade_facilities',
    description: 'Trade Facilities (LC, BG, Guarantees)',
    required_docs: ['Trade License', 'Financial Statements', 'Contract Copy'],
    sub_services: [],
    sort_order: 2,
  },
  {
    name: 'sukuk_funding',
    description: 'Sukuk Funding',
    required_docs: ['Project Proposal', 'Financial Statements', 'Sharia Compliance'],
    sub_services: [],
    sort_order: 3,
  },
  {
    name: 'project_funding',
    description: 'Project Funding',
    required_docs: ['Feasibility Study', 'Business Plan', 'Financial Projections'],
    sub_services: [],
    sort_order: 4,
  },
  {
    name: 'corporate_loans',
    description: 'Corporate Loans',
    required_docs: ['Business Plan', 'Financial Statements', 'Collateral Details'],
    sub_services: [],
    sort_order: 5,
  },
  {
    name: 'investment_advisory',
    description: 'Investment Advisory',
    required_docs: ['Financial Goals', 'Risk Profile', 'Investment History'],
    sub_services: [],
    sort_order: 6,
  },
  {
    name: 'other',
    description: 'Other Custom Services',
    required_docs: ['Service Requirements', 'Client Details'],
    sub_services: [],
    sort_order: 7,
  },
];

const ensureSchema = async () => {
  const client = await pool.connect();
  try {
    // ---- users: archive + email verification columns ----
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS archived_by INT NULL,
        ADD COLUMN IF NOT EXISTS archived_reason TEXT NULL,
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verification_token TEXT NULL,
        ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS signup_ip TEXT NULL
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_signup_ip ON users (signup_ip)`);

    // Existing approved accounts should not be locked out by the new gate.
    await client.query(`
      UPDATE users
      SET email_verified = true
      WHERE email_verified = false AND is_active = true
    `);

    // ---- services catalog ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        required_docs JSONB NOT NULL DEFAULT '[]',
        sub_services JSONB NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM services');
    if (rows[0].count === 0) {
      for (const s of DEFAULT_SERVICES) {
        await client.query(
          `INSERT INTO services (name, description, required_docs, sub_services, sort_order)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
           ON CONFLICT (name) DO NOTHING`,
          [s.name, s.description, JSON.stringify(s.required_docs), JSON.stringify(s.sub_services), s.sort_order]
        );
      }
      console.log(`🌱 Seeded ${DEFAULT_SERVICES.length} default services`);
    }

    console.log('✅ Schema ensured (users columns + services table)');
  } catch (err) {
    console.error('❌ ensureSchema failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { ensureSchema };
