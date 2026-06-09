// NotionLeads MVP - Core Engine
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');

const app = express();
app.use(cors());
app.use(express.json());

// ─── الاتصال بـ Notion ───
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ─── دالة: قراءة Leads من Notion ───
async function getLeads() {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: {
        property: 'Status',
        select: {
          does_not_equal: 'Closed'
        }
      }
    });
    return response.results;
  } catch (error) {
    console.error('Error fetching leads:', error.message);
    return [];
  }
}

// ─── دالة: حساب الأيام منذ آخر متابعة ───
function daysSinceContact(lastContacted) {
  if (!lastContacted) return 999;
  const last = new Date(lastContacted);
  const now = new Date();
  const diff = now - last;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─── دالة: تحديد الحالة التلقائية ───
function autoStatus(days, currentStatus) {
  if (days === 999) return 'New';
  if (days <= 2) return currentStatus;
  if (days <= 7) return 'Contacted';
  if (days <= 14) return 'Follow-up Needed';
  return 'At Risk';
}

// ─── دالة: تحديث Lead في Notion ───
async function updateLead(pageId, status) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Status': {
          select: { name: status }
        }
      }
    });
    console.log(`Updated lead to: ${status}`);
  } catch (error) {
    console.error(`Error updating lead:`, error.message);
  }
}

// ─── الوظيفة الرئيسية: المسح اليومي ───
async function dailyScan() {
  console.log('Starting daily scan...', new Date().toLocaleString());
  
  const leads = await getLeads();
  console.log(`Found ${leads.length} active leads`);
  
  for (const lead of leads) {
    const props = lead.properties;
    const name = props.Name?.title?.[0]?.plain_text || 'Unknown';
    const status = props.Status?.select?.name || 'New';
    const lastContacted = props['Last Contacted']?.date?.start;
    
    const days = daysSinceContact(lastContacted);
    const newStatus = autoStatus(days, status);
    
    console.log(`${name}: ${days} days since contact -> ${newStatus}`);
    
    if (newStatus !== status) {
      await updateLead(lead.id, newStatus);
    }
  }
  
  console.log('Daily scan complete');
}

// ─── API Endpoints ───

app.get('/', (req, res) => {
  res.json({ 
    message: 'NotionLeads API is running',
    version: '1.0.0',
    endpoints: ['/health', '/scan', '/leads'],
    timestamp: new Date()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.post('/scan', async (req, res) => {
  const { secret } = req.headers;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    await dailyScan();
    res.json({ success: true, message: 'Scan completed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/leads', async (req, res) => {
  try {
    const leads = await getLeads();
    const simplified = leads.map(lead => ({
      id: lead.id,
      name: lead.properties.Name?.title?.[0]?.plain_text,
      company: lead.properties.Company?.rich_text?.[0]?.plain_text,
      email: lead.properties.Email?.email,
      status: lead.properties.Status?.select?.name,
      lastContacted: lead.properties['Last Contacted']?.date?.start,
      source: lead.properties.Source?.select?.name
    }));
    res.json({ count: simplified.length, leads: simplified });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── تشغيل السيرفر ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NotionLeads running on http://localhost:${PORT}`);
  console.log(`Ready for daily scans`);
});

module.exports = app;