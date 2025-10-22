const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware to verify Supabase JWT
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// Get all deals
app.get('/api/deals', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('business_ideas')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new deal
app.post('/api/deals', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('business_ideas')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update deal
app.put('/api/deals/:id', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('business_ideas')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete deal
app.delete('/api/deals/:id', verifyAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('business_ideas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Deal deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send outreach email
app.post('/api/webhook/send-outreach', verifyAuth, async (req, res) => {
  try {
    const { dealId } = req.body;

    // Get deal details
    const { data: deal, error: dealError } = await supabase
      .from('business_ideas')
      .select('*')
      .eq('id', dealId)
      .single();

    if (dealError) throw dealError;

    // Send email
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: deal.contact_email,
      subject: `Investment Opportunity: ${deal.business_name}`,
      html: `
        <h2>Price Capital - Deal Outreach</h2>
        <p>Dear ${deal.contact_name},</p>
        <p>We're interested in learning more about ${deal.business_name}.</p>
        <p><strong>Details:</strong></p>
        <ul>
          <li>Business: ${deal.business_name}</li>
          <li>Industry: ${deal.industry}</li>
          <li>Funding Requested: $${deal.funding_amount_requested?.toLocaleString()}</li>
        </ul>
        <p>Best regards,<br>Price Capital Team</p>
      `
    });

    // Log webhook
    await supabase.from('webhook_logs').insert([{
      business_idea_id: dealId,
      action: 'send_outreach',
      triggered_by: req.user.email,
      status: 'success',
      details: { email_sent_to: deal.contact_email }
    }]);

    res.json({ message: 'Outreach email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google Form webhook (no auth required)
app.post('/api/webhook/google-form', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('business_ideas')
      .insert([{
        ...req.body,
        source: 'google_form',
        stage: 'submitted'
      }])
      .select()
      .single();

    if (error) throw error;

    // Log webhook
    await supabase.from('webhook_logs').insert([{
      business_idea_id: data.id,
      action: 'form_submission',
      triggered_by: 'google_form',
      status: 'success'
    }]);

    res.status(201).json({ message: 'Deal created from form', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get webhook logs
app.get('/api/webhooks', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*, business_ideas(*)')
      .order('triggered_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user profile
app.get('/api/user/profile', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (admin only)
app.get('/api/users', verifyAuth, async (req, res) => {
  try {
    // Check if user is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('username');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
