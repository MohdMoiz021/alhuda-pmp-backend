const pool = require('../db'); // Your database connection

/**
 * Get partner phone number by case ID
 */
const getPartnerPhoneByCaseId = async (caseId) => {
  try {
    // Query based on your database schema
    // Adjust table names and column names according to your actual schema
    const query = `
      SELECT 
        c.id as case_id,
        c.case_reference,
        p.id as partner_id,
        p.name as partner_name,
        p.email as partner_email,
        p.phone as partner_phone,
        p.phone_country_code,
        p.whatsapp_number,
        p.preferred_contact
      FROM cases c
      JOIN partners p ON c.partner_id = p.id
      WHERE c.id = ? OR c.case_reference = ?
    `;

    const [rows] = await pool.execute(query, [caseId, caseId]);
    
    if (rows.length === 0) {
      return null;
    }

    const partner = rows[0];
    
    // Determine which phone number to use
    const phoneNumber = partner.whatsapp_number || partner.partner_phone;
    
    return {
      caseId: partner.case_id,
      caseReference: partner.case_reference,
      partnerId: partner.partner_id,
      partnerName: partner.partner_name,
      partnerEmail: partner.partner_email,
      phoneNumber: phoneNumber,
      countryCode: partner.phone_country_code,
      preferredContact: partner.preferred_contact
    };
    
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
};

/**
 * Get partner phone by case reference only
 */
const getPartnerPhoneByCaseReference = async (caseReference) => {
  try {
    const query = `
      SELECT 
        c.id as case_id,
        c.case_reference,
        p.id as partner_id,
        p.name as partner_name,
        p.email as partner_email,
        p.phone as partner_phone,
        p.phone_country_code,
        p.whatsapp_number
      FROM cases c
      JOIN partners p ON c.partner_id = p.id
      WHERE c.case_reference = ?
    `;

    const [rows] = await pool.execute(query, [caseReference]);
    
    if (rows.length === 0) {
      return null;
    }

    const partner = rows[0];
    const phoneNumber = partner.whatsapp_number || partner.partner_phone;
    
    return {
      caseId: partner.case_id,
      caseReference: partner.case_reference,
      partnerId: partner.partner_id,
      partnerName: partner.partner_name,
      partnerEmail: partner.partner_email,
      phoneNumber: phoneNumber,
      countryCode: partner.phone_country_code
    };
    
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
};

module.exports = {
  getPartnerPhoneByCaseId,
  getPartnerPhoneByCaseReference
};