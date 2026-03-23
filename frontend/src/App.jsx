import React, { useState, useEffect } from 'react';
import VoiceRecorder from './components/VoiceRecorder';
import CalendarView from './components/CalendarView';
import axios from 'axios';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lastTranscription, setLastTranscription] = useState(null);
  const [refreshCalendar, setRefreshCalendar] = useState(0);
  const [suggestion, setSuggestion] = useState(null);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    // Check if we have a session cookie by trying to fetch events
    const checkAuth = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/calendar/events', {
          credentials: 'include'
        });
        if (response.ok) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.log('Not authenticated');
      }
    };
    checkAuth();
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/google`;
  };

  const handleTranscription = async (data) => {
    setLastTranscription(data);
    setSuggestion(data.suggestion);

    const intent = data.intent?.intent;
    const details = data.intent?.eventDetails;
    const deleteDetails = data.intent?.deleteDetails;

    try {
      // CREATE EVENT
      if (intent === 'create_event' && details) {
        await axios.post(
          'http://localhost:3000/api/calendar/events',
          {
            summary: details.summary,
            description: details.description || '',
            startTime: details.startTime,
            endTime: details.endTime,
          },
          { withCredentials: true }
        );
        console.log('Event created');
      }

      // DELETE EVENT
      if (intent === 'delete_event' && deleteDetails?.summary) {
        // Fetch current events to find the one to delete
        const eventsRes = await axios.get(
          'http://localhost:3000/api/calendar/events',
          { withCredentials: true }
        );
        const events = eventsRes.data;

        const eventToDelete = findEventToDelete(
          events,
          deleteDetails.summary,
          deleteDetails.startTime
        );

        if (eventToDelete) {
          await axios.delete(
            `http://localhost:3000/api/calendar/events/${eventToDelete.id}`,
            { withCredentials: true }
          );
          console.log('Event deleted');
        } else {
          alert(`Could not find event: "${deleteDetails.summary}"`);
        }
      }

      // Refresh calendar after any change
      if (['create_event', 'delete_event'].includes(intent)) {
        setRefreshCalendar(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error processing voice action:', error);
      alert('Action failed. Check console.');
    }
  };

  const applySuggestion = async (suggestion) => {
    setIsApplying(true);
    try {
      const response = await axios.post(
        'http://localhost:3000/api/calendar/events/reschedule',
        {
          eventId: suggestion.event.id,
          newStart: suggestion.proposedStart,
          newEnd: suggestion.proposedEnd,
        },
        { withCredentials: true }
      );

      // Success: clear the suggestion and refresh calendar
      setSuggestion(null);
      setRefreshCalendar(prev => prev + 1);
      alert('Event rescheduled successfully!');
    } catch (error) {
      console.error('Error applying suggestion:', error);
      alert('Failed to reschedule. Please try again.');
    } finally {
    setIsApplying(false);  // This always runs, re-enabling the button
    }
  };
  // Helper to find an event by summary and approximate start time
  const findEventToDelete = (events, summary, startTime) => {
    return events.find(event => {
      const titleMatch = event.summary?.toLowerCase().includes(summary.toLowerCase());
      if (!titleMatch) return false;
      if (startTime) {
        // Compare times within a 5-minute window
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const targetStart = new Date(startTime);
        const timeDiff = Math.abs(eventStart - targetStart);
        return timeDiff < 5 * 60 * 1000; // within 5 minutes
      }
      return true; // if no time given, just match by title
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Alma</h1>
        <p>Your AI Life Management Assistant</p>
        {!isAuthenticated && (
          <button onClick={handleLogin}>Connect Google Calendar</button>
        )}
      </header>

      <main className="app-main">
        {isAuthenticated ? (
          <>
            <section className="voice-section">
              <VoiceRecorder onTranscriptionComplete={handleTranscription} />
              {lastTranscription && (
                <div className="transcription-result">
                  <h3>I heard:</h3>
                  <p>{lastTranscription.transcribedText}</p>
                  <h3>Intent:</h3>
                  <pre>{JSON.stringify(lastTranscription.intent, null, 2)}</pre>
                </div>
              )}
            </section>

            {suggestion && (
            <section className="suggestion-section">
              <h3>✨ Alma's Suggestion</h3>
              <p>
                To help with your overwhelmed feeling, I suggest moving
                <strong> {suggestion.event.summary} </strong>
                from {new Date(suggestion.event.originalStart).toLocaleTimeString()} to{' '}
                {new Date(suggestion.proposedStart).toLocaleTimeString()} on{' '}
                {new Date(suggestion.proposedStart).toLocaleDateString()}.
              </p>
              <div className="suggestion-actions">
                <button onClick={() => applySuggestion(suggestion)} className="apply-btn" disabled={isApplying}> 
                  {isApplying ? 'Applying...' : 'Apply'}
                </button>
                <button onClick={() => setSuggestion(null)} className="dismiss-btn" disabled={isApplying}>
                  Dismiss
                </button>
              </div>
            </section>
            )}

            <section className="calendar-section">
              <CalendarView refreshTrigger={refreshCalendar} />
            </section>
          </>
        ) : (
          <div className="login-prompt">
            <p>Please connect your Google Calendar to get started</p>
            <button onClick={handleLogin}>Connect Now</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;