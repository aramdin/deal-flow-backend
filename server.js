const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - Enhanced CORS
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email transporter (optional - only if SMTP credentials are provided)
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    smtp_configured: !!transporter,
    supabase_connected: !!process.env.SUPABASE_URL
  });
});

// Middleware to verify Supabase JWT
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No auth token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('❌ Invalid token:', error?.message);
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('✅ User authenticated:', user.email);
    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// Get all deals
app.get('/api/deals', verifyAuth, async (req, res) => {
  try {
    console.log('📋 Fetching deals...');
    const { data, error } = await supabase
      .from('business_ideas')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    console.log(`✅ Found ${data.length} deals`);
    res.json(data);
  } catch (error) {
    console.error('❌ Get deals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new deal
app.post('/api/deals', verifyAuth, async (req, res) => {
  try {
    console.log('➕ Creating deal:', req.body.business_name);
    const { data, error } = await supabase
      .from('business_ideas')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Deal created:', data.id);
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Create deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update deal
app.put('/api/deals/:id', verifyAuth, async (req, res) => {
  try {
    console.log('✏️ Updating deal:', req.params.id);
    const { data, error } = await supabase
      .from('business_ideas')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Deal updated:', data.id);
    res.json(data);
  } catch (error) {
    console.error('❌ Update deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete deal
app.delete('/api/deals/:id', verifyAuth, async (req, res) => {
  try {
    console.log('🗑️ Deleting deal:', req.params.id);
    const { error } = await supabase
      .from('business_ideas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    console.log('✅ Deal deleted');
    res.json({ message: 'Deal deleted successfully' });
  } catch (error) {
    console.error('❌ Delete deal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send outreach email (with authentication - requires SMTP)
app.post('/api/webhook/send-outreach', verifyAuth, async (req, res) => {
  try {
    const { dealId } = req.body;
    console.log('📧 Sending outreach for deal:', dealId);

    if (!transporter) {
      return res.status(503).json({ 
        error: 'Email service not configured. Use external webhook instead.' 
      });
    }

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

    console.log('✅ Outreach email sent');
    res.json({ message: 'Outreach email sent successfully' });
  } catch (error) {
    console.error('❌ Send outreach error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Google Form webhook (no auth required)
app.post('/api/webhook/google-form', async (req, res) => {
  try {
    console.log('📝 Google Form submission:', req.body.business_name);
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

    console.log('✅ Form submission processed:', data.id);
    res.status(201).json({ message: 'Deal created from form', data });
  } catch (error) {
    console.error('❌ Google Form webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// External webhook for Make.com / GoHighLevel (no auth required)
app.post('/api/webhook/outreach-external', async (req, res) => {
  try {
    console.log('🔗 External webhook received');
    
    // Optional: Check for webhook secret for security
    if (process.env.WEBHOOK_SECRET) {
      const secret = req.headers['x-webhook-secret'];
      if (secret !== process.env.WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { 
      dealId, 
      email, 
      companyName, 
      contactName, 
      industry, 
      fundingAmount,
      description,
      website
    } = req.body;

    // Log webhook
    await supabase.from('webhook_logs').insert([{
      business_idea_id: dealId || null,
      action: 'outreach_external',
      triggered_by: 'make_com_or_ghl',
      status: 'success',
      details: { 
        email_sent_to: email,
        company_name: companyName,
        platform: req.headers['user-agent'] || 'unknown'
      }
    }]);

    console.log('✅ External webhook logged');
    res.status(200).json({ 
      success: true,
      message: 'Webhook received successfully',
      data: {
        dealId,
        email,
        companyName,
        contactName,
        industry,
        fundingAmount,
        description,
        website,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ External webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger external webhook for a deal (authenticated)
app.post('/api/webhook/trigger-outreach', verifyAuth, async (req, res) => {
  try {
    const { dealId, webhookUrl } = req.body;
    console.log('🚀 Triggering outreach for deal:', dealId);

    // Get deal details
    const { data: deal, error: dealError } = await supabase
      .from('business_ideas')
      .select('*')
      .eq('id', dealId)
      .single();

    if (dealError) throw dealError;

    // If webhookUrl is provided, send data there
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': process.env.WEBHOOK_SECRET || ''
        },
        body: JSON.stringify({
          dealId: deal.id,
          email: deal.contact_email,
          companyName: deal.business_name,
          contactName: deal.contact_name,
          industry: deal.industry,
          fundingAmount: deal.funding_amount_requested,
          description: deal.description,
          website: deal.website_url,
          stage: deal.stage
        })
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.statusText}`);
      }
    }

    // Log webhook
    await supabase.from('webhook_logs').insert([{
      business_idea_id: dealId,
      action: 'trigger_outreach',
      triggered_by: req.user.email,
      status: 'success',
      details: { 
        webhook_url: webhookUrl,
        company_name: deal.business_name 
      }
    }]);

    console.log('✅ Outreach triggered');
    res.json({ 
      success: true,
      message: 'Outreach triggered successfully',
      deal: deal.business_name
    });
  } catch (error) {
    console.error('❌ Trigger outreach error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get webhook logs
app.get('/api/webhooks', verifyAuth, async (req, res) => {
  try {
    console.log('📊 Fetching webhook logs...');
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*, business_ideas(*)')
      .order('triggered_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    console.log(`✅ Found ${data.length} webhook logs`);
    res.json(data);
  } catch (error) {
    console.error('❌ Get webhooks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user profile - ROBUST VERSION
app.get('/api/user/profile', verifyAuth, async (req, res) => {
  try {
    console.log('👤 Fetching profile for:', req.user.email);
    
    // Try to get from user_profiles table
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    // If profile exists, return it
    if (data && !error) {
      console.log('✅ Profile found in database');
      return res.json(data);
    }

    // No profile exists - create one automatically
    console.log('⚠️ No profile found, creating one...');
    
    const newProfile = {
      id: req.user.id,
      username: req.user.email.split('@')[0],
      email: req.user.email,
      role: 'user',
      full_name: req.user.user_metadata?.full_name || null
    };

    const { data: createdProfile, error: createError } = await supabase
      .from('user_profiles')
      .insert([newProfile])
      .select()
      .single();

    if (createError) {
      console.error('❌ Failed to create profile:', createError);
      // Return basic profile even if creation fails
      return res.json(newProfile);
    }

    console.log('✅ Profile created successfully');
    res.json(createdProfile);
    
  } catch (error) {
    console.error('❌ Profile error:', error);
    // Always return something - fallback to basic user info
    res.json({
      id: req.user.id,
      username: req.user.email.split('@')[0],
      email: req.user.email,
      role: 'user'
    });
  }
});

// Get all users (admin only)
app.get('/api/users', verifyAuth, async (req, res) => {
  try {
    console.log('👥 Fetching all users...');
    
    // Check if user is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      console.log('❌ User is not admin');
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('username');

    if (error) throw error;
    console.log(`✅ Found ${data.length} users`);
    res.json(data);
  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Price Capital Deal Flow Backend');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📧 SMTP configured: ${!!transporter}`);
  console.log(`🔒 Webhook secret: ${!!process.env.WEBHOOK_SECRET}`);
  console.log(`🗄️ Supabase: ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ Not configured'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
