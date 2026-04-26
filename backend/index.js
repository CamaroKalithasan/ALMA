const express = require('express');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
const { addDays } = require('date-fns');
const session = require('express-session');

// --- New: database helper for shopping list ---
const db = require('./db');   // we'll create db.js next

dotenv.config();
console.log('SESSION_SECRET exists?', !!process.env.SESSION_SECRET);
console.log('SESSION_SECRET length:', process.env.SESSION_SECRET ? process.env.SESSION_SECRET.length : 0);
const app = express();

app.get('/ping', (req, res) => res.send('pong'));
app.use(cors({ origin: 'https://alma-gamma.vercel.app', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (req) => req.secure,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SCOPES = ['https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email'
];

// --- Helper to fetch user info from Google ---
async function getUserInfo(accessToken) {
  const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.data;
}

// Auth routes
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  res.redirect(url);
});

// --- Updated OAuth callback: store user email ---
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  req.session.tokens = tokens;

  // Fetch user email and store in session
  const userInfo = await getUserInfo(tokens.access_token);
  req.session.user = { email: userInfo.email, name: userInfo.name };
  console.log('User email stored:', req.session.user.email);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(frontendUrl);
});

// -------------------- Calendar Endpoints (existing) --------------------
app.get('/api/calendar/events', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  oauth2Client.setCredentials(req.session.tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekLater.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });
  res.json(response.data.items);
});

app.post('/api/calendar/events', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  oauth2Client.setCredentials(req.session.tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const event = {
    summary: req.body.summary,
    description: req.body.description,
    start: { dateTime: req.body.startTime, timeZone: 'America/New_York' },
    end: { dateTime: req.body.endTime, timeZone: 'America/New_York' }
  };
  const response = await calendar.events.insert({ calendarId: 'primary', resource: event });
  res.json(response.data);
});

app.delete('/api/calendar/events/:eventId', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  oauth2Client.setCredentials(req.session.tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({ calendarId: 'primary', eventId: req.params.eventId });
  res.json({ success: true });
});

// -------------------- Shopping List Endpoints (new) --------------------
app.post('/api/shopping/add', async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { itemName } = req.body;
  if (!itemName || itemName.trim() === '') {
    return res.status(400).json({ error: 'Item name required' });
  }
  try {
    const result = await db.query(
      'INSERT INTO shopping_items (user_email, item_name) VALUES ($1, $2) RETURNING *',
      [req.session.user.email, itemName.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/shopping/list', async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const result = await db.query(
      'SELECT * FROM shopping_items WHERE user_email = $1 ORDER BY created_at DESC',
      [req.session.user.email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/shopping/remove/:id', async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { id } = req.params;
  try {
    await db.query('DELETE FROM shopping_items WHERE id = $1 AND user_email = $2', [id, req.session.user.email]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// -------------------- Voice Processing (Whisper + GPT) --------------------
app.post('/api/process-voice', async (req, res) => {
  const { audio, userTimezone } = req.body;
  try {
    const base64Data = audio.split(',')[1];
    const audioBuffer = Buffer.from(base64Data, 'base64');
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
    const transcription = await openai.audio.transcriptions.create({ file, model: 'whisper-1' });
    const text = transcription.text;

    const now = new Date();
    const serverOffsetMinutes = now.getTimezoneOffset();
    const serverOffsetHours = Math.floor(Math.abs(serverOffsetMinutes) / 60);
    const serverOffsetSign = serverOffsetMinutes > 0 ? '-' : '+';
    const serverOffsetString = `${serverOffsetSign}${String(serverOffsetHours).padStart(2,'0')}:${String(Math.abs(serverOffsetMinutes) % 60).padStart(2,'0')}`;
    const offsetString = userTimezone || serverOffsetString;

    // --- Extended system prompt to include shopping intents ---
    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: `You are Alma, an AI life management assistant. 
          Today is ${now.toLocaleDateString('en-CA')} and the current time is ${now.toLocaleTimeString('en-US', { hour12: false })}.
          The current timezone offset is ${offsetString} (e.g., -04:00 for EDT). 
          When generating ISO 8601 date-time strings, ALWAYS use this offset.

          Extract the following from the user's message in JSON format. Do NOT use markdown code blocks or backticks. Return plain JSON only.

            - intent: create_event, delete_event, check_schedule, feeling_overwhelmed, shopping_add, shopping_show, shopping_remove, or other
            - emotionalState: overwhelmed, tired, fine, etc.
            - affectedDate: if mentioned (e.g., "tomorrow", "next Monday") – use YYYY-MM-DD if possible
            - eventDetails: (only if intent is create_event) an object with:
                * summary (string)
                * startTime: ISO 8601 string with offset
                * endTime: ISO 8601 string (default to startTime + 1 hour)
                * description (optional)
                * priority (low/medium/high, if mentioned)
            - deleteDetails: (only if intent is delete_event) an object with:
                * summary (string, required)
                * startTime: ISO 8601 string with offset (if mentioned, helps identify the exact event)
                * description (optional)
            - shoppingDetails: (only if intent is shopping_add) an object with:
                * item: string (e.g., "milk")
          Respond with valid JSON only.`
        },
        { role: 'user', content: text }
      ]
    });

    let rawContent = gptResponse.choices[0].message.content;
    rawContent = rawContent.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
    const intent = JSON.parse(rawContent);

    // --- Feeling overwhelmed suggestion (existing) ---
    let suggestion = null;
    if (intent.intent === 'feeling_overwhelmed' && req.session.tokens) {
      let targetDate = new Date();
      if (intent.affectedDate && intent.affectedDate.toLowerCase().includes('tomorrow')) {
        targetDate = addDays(new Date(), 1);
      } else {
        targetDate = addDays(new Date(), 1);
      }
      oauth2Client.setCredentials(req.session.tokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      const eventsResponse = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });
      const events = eventsResponse.data.items;
      if (events.length > 0) {
        const lastEvent = events[events.length - 1];
        const eventStart = new Date(lastEvent.start.dateTime || lastEvent.start.date);
        const eventEnd = new Date(lastEvent.end.dateTime || lastEvent.end.date);
        const searchStart = addDays(startOfDay, 1);
        const freeSlot = await findFreeSlot(oauth2Client, searchStart, eventEnd - eventStart);
        if (freeSlot) {
          suggestion = {
            event: {
              id: lastEvent.id,
              summary: lastEvent.summary,
              originalStart: eventStart.toISOString(),
              originalEnd: eventEnd.toISOString(),
            },
            proposedStart: freeSlot.start.toISOString(),
            proposedEnd: freeSlot.end.toISOString(),
          };
        }
      }
    }

    res.json({ transcribedText: text, intent, suggestion });
  } catch (error) {
    console.error('Error processing voice:', error.response?.data || error.message);
    res.status(500).json({ error: 'Voice processing failed', details: error.message });
  }
});

// Helper function for free slot (unchanged)
async function findFreeSlot(authClient, startFrom, durationMs) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  const timeMin = new Date(startFrom);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(startFrom);
  timeMax.setDate(timeMax.getDate() + 7);
  timeMax.setHours(23, 59, 59, 999);
  const freebusyResponse = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });
  const busy = freebusyResponse.data.calendars.primary.busy || [];
  busy.sort((a, b) => new Date(a.start) - new Date(b.start));
  let currentStart = new Date(startFrom);
  for (let i = 0; i < busy.length; i++) {
    const busyStart = new Date(busy[i].start);
    const busyEnd = new Date(busy[i].end);
    const slotEnd = new Date(currentStart.getTime() + durationMs);
    if (slotEnd <= busyStart) {
      return { start: currentStart, end: slotEnd };
    }
    if (currentStart < busyEnd) currentStart = busyEnd;
  }
  const finalSlotEnd = new Date(currentStart.getTime() + durationMs);
  if (finalSlotEnd <= timeMax) return { start: currentStart, end: finalSlotEnd };
  return null;
}

// Reschedule endpoint (unchanged)
app.post('/api/calendar/events/reschedule', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  const { eventId, newStart, newEnd } = req.body;
  try {
    oauth2Client.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const existingEvent = await calendar.events.get({ calendarId: 'primary', eventId });
    const updatedEvent = {
      ...existingEvent.data,
      start: { dateTime: newStart, timeZone: 'America/New_York' },
      end: { dateTime: newEnd, timeZone: 'America/New_York' },
    };
    const response = await calendar.events.update({ calendarId: 'primary', eventId, resource: updatedEvent });
    res.json(response.data);
  } catch (error) {
    console.error('Error rescheduling event:', error.response?.data || error.message);
    res.status(500).json({ error: 'Reschedule failed', details: error.message });
  }
});

// Test endpoints (optional)
app.get('/set-session', (req, res) => {
  req.session.test = 'hello';
  console.log('Set session test. Session ID:', req.sessionID);
  res.send('Session set. Check cookie.');
});
app.get('/test-cookie', (req, res) => {
  res.cookie('test', 'value', { httpOnly: true, sameSite: 'none', secure: true, maxAge: 3600000 });
  res.send('Cookie test. Check headers.');
});

app.listen(process.env.PORT, () => console.log(`Alma backend running on port ${process.env.PORT}`));