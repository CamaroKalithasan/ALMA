const express = require('express');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
const { addDays, format, parseISO } = require('date-fns');
const session = require('express-session');

dotenv.config();
console.log('SESSION_SECRET exists?', !!process.env.SESSION_SECRET);
console.log('SESSION_SECRET length:', process.env.SESSION_SECRET ? process.env.SESSION_SECRET.length : 0);
const app = express();

app.get('/ping', (req, res) => res.send('pong')); // testing deployment
app.use(cors({ origin: 'https://alma-gamma.vercel.app', credentials: true }));
app.use(express.json({ limit: '10mb' }));
// Tell Express to trust the first proxy (Render/Cloudflare)
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (req) => req.secure,   // only set Secure flag if request is HTTPS
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Auth routes
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  req.session.tokens = tokens;
  console.log('Session saved. Session ID:', req.sessionID);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(frontendUrl);
});

// Get events
app.get('/api/calendar/events', async (req, res) => {
  console.log('Session in /api/calendar/events:', req.session);
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

// Create event
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

// Delete event
app.delete('/api/calendar/events/:eventId', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  oauth2Client.setCredentials(req.session.tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({ calendarId: 'primary', eventId: req.params.eventId });
  res.json({ success: true });
});

// Voice processing (Whisper + GPT)
app.post('/api/process-voice', async (req, res) => {
  const { audio } = req.body; // base64 audio string (e.g., "data:audio/webm;base64,AAAA...")

  try {
    // 1. Extract the base64 data (remove the data URL prefix)
    const base64Data = audio.split(',')[1];
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // 2. Create a temporary file-like object for Whisper (Node 18+)
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

    // 3. Use OpenAI SDK to transcribe
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
    });

    const text = transcription.text;

    // Get current date and time info for context
    const now = new Date();
    const offsetMinutes = now.getTimezoneOffset(); // e.g., 240 for EDT
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetSign = offsetMinutes > 0 ? '-' : '+';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2,'0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2,'0')}`;

    // 4. Parse intent with GPT
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

            - intent: create_event, delete_event, check_schedule, feeling_overwhelmed, or other
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
          Respond with valid JSON only.` 
        },
        { role: 'user', content: text }
      ]
    });

    // After getting the GPT response content
    let rawContent = gptResponse.choices[0].message.content;

    // Remove markdown code fences if present
    rawContent = rawContent.replace(/```json\s*/g, '').replace(/\s*```/g, '');

    // Also trim any extra whitespace
    rawContent = rawContent.trim();

    // Now parse
    const intent = JSON.parse(rawContent);
    
    // NEW: Handle feeling_overwhelmed
    let suggestion = null;
    if (intent.intent === 'feeling_overwhelmed' && req.session.tokens) {
      // Determine which day to look at (default to tomorrow)
      let targetDate = new Date();
      if (intent.affectedDate) {
        // If GPT extracted something like "tomorrow" or a date, parse it
        // For simplicity, handle "tomorrow" only now
        if (intent.affectedDate.toLowerCase().includes('tomorrow')) {
          targetDate = addDays(new Date(), 1);
        } // else could parse YYYY-MM-DD if we output that format
      } else {
        targetDate = addDays(new Date(), 1); // default to tomorrow
      }

      // Fetch events for that day
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
        // Simple heuristic: pick the last event of the day
        const lastEvent = events[events.length - 1];
        const eventStart = new Date(lastEvent.start.dateTime || lastEvent.start.date);
        const eventEnd = new Date(lastEvent.end.dateTime || lastEvent.end.date);

        // Find next free slot after tomorrow, same duration
        const searchStart = addDays(startOfDay, 1); // start looking from the next day
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

    // Return both intent and suggestion (if any)
    res.json({
      transcribedText: text,
      intent,
      suggestion, // will be null if no suggestion
    });
  } catch (error) {
    console.error('Error processing voice:', error.response?.data || error.message);
    res.status(500).json({ error: 'Voice processing failed', details: error.message });
  }
});

// Helper function to find a free time slot using Google Calendar freebusy
async function findFreeSlot(authClient, startFrom, durationMs) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  // Define the search window: from startFrom to startFrom + 7 days (or you can adjust)
  const timeMin = new Date(startFrom);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(startFrom);
  timeMax.setDate(timeMax.getDate() + 7);
  timeMax.setHours(23, 59, 59, 999);

  // First, get all busy periods in that window
  const freebusyResponse = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });

  const busy = freebusyResponse.data.calendars.primary.busy || [];
  // Sort busy periods by start time
  busy.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Now scan for a gap of at least durationMs starting from startFrom
  let currentStart = new Date(startFrom);
  for (let i = 0; i < busy.length; i++) {
    const busyStart = new Date(busy[i].start);
    const busyEnd = new Date(busy[i].end);

    // If currentStart + duration fits before this busy period
    const slotEnd = new Date(currentStart.getTime() + durationMs);
    if (slotEnd <= busyStart) {
      return { start: currentStart, end: slotEnd };
    }

    // Otherwise, move currentStart to after this busy period
    if (currentStart < busyEnd) {
      currentStart = busyEnd;
    }
  }

  // Check after the last busy period
  const finalSlotEnd = new Date(currentStart.getTime() + durationMs);
  if (finalSlotEnd <= timeMax) {
    return { start: currentStart, end: finalSlotEnd };
  }

  return null; // no free slot found
}

// Reschedule an event
app.post('/api/calendar/events/reschedule', async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { eventId, newStart, newEnd } = req.body;

  try {
    oauth2Client.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // First, fetch the existing event to preserve its other fields
    const existingEvent = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId,
    });

    // Update only the start and end times
    const updatedEvent = {
      ...existingEvent.data,
      start: { dateTime: newStart, timeZone: 'America/New_York' },
      end: { dateTime: newEnd, timeZone: 'America/New_York' },
    };

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      resource: updatedEvent,
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error rescheduling event:', error.response?.data || error.message);
    res.status(500).json({ error: 'Reschedule failed', details: error.message });
  }
});

app.get('/set-session', (req, res) => {
  req.session.test = 'hello';
  console.log('Set session test. Session ID:', req.sessionID);
  res.send('Session set. Check cookie.');
});

app.get('/test-cookie', (req, res) => {
  res.cookie('test', 'value', {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 3600000
  });
  res.send('Cookie test. Check headers.');
});

app.listen(process.env.PORT, () => console.log(`Alma backend running on port ${process.env.PORT}`));