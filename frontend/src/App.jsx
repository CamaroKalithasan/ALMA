import React, { useState, useEffect, useRef } from 'react';  // Add useRef import
import VoiceRecorder from './components/VoiceRecorder';
import CalendarView from './components/CalendarView';
import Sidebar from './components/Sidebar';
import VoiceAssistant from './components/VoiceAssistant';
import ShoppingList from './components/ShoppingList';
import axios from 'axios';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [lastTranscription, setLastTranscription] = useState(null);
  const [refreshCalendar, setRefreshCalendar] = useState(0);
  const [refreshShopping, setRefreshShopping] = useState(0);
  const [suggestion, setSuggestion] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  
  // Add ref for VoiceRecorder
  const voiceRecorderRef = useRef(null);

  useEffect(() => {
    // Auto-hide splash screen after animation
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/calendar/events`, {
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
      if (intent === 'create_event' && details) {
        await axios.post(
          `${API_BASE}/api/calendar/events`,
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

      if (intent === 'delete_event' && deleteDetails?.summary) {
        const eventsRes = await axios.get(
          `${API_BASE}/api/calendar/events`,
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
            `${API_BASE}/api/calendar/events/${eventToDelete.id}`,
            { withCredentials: true }
          );
          console.log('Event deleted');
        } else {
          alert(`Could not find event: "${deleteDetails.summary}"`);
        }
      }

      if (['create_event', 'delete_event'].includes(intent)) {
        setRefreshCalendar(prev => prev + 1);
      }

      if (intent === 'shopping_add' && data.intent?.shoppingDetails?.item) {
        const item = data.intent.shoppingDetails.item;
        console.log('Processing shopping add, item:', item);
        try {
          await axios.post(`${API_BASE}/api/shopping/add`, { itemName: item }, { withCredentials: true });
          console.log(`Added "${item}" to shopping list`);
          setRefreshShopping(prev => prev + 1);  // trigger refresh
          console.log('Incrementing refreshShopping from', prev, 'to', prev+1);
          // Optionally show a success message (or use a toast)
        } catch (err) {
          console.error('Failed to add shopping item', err);
          alert('Failed to add item to shopping list');
        }
      }
    } catch (error) {
      console.error('Error processing voice action:', error);
      alert('Action failed. Check console.');
    }
  };

  const applySuggestion = async (suggestion) => {
    setIsApplying(true);
    try {
      await axios.post(
        `${API_BASE}/api/calendar/events/reschedule`,
        {
          eventId: suggestion.event.id,
          newStart: suggestion.proposedStart,
          newEnd: suggestion.proposedEnd,
        },
        { withCredentials: true }
      );

      setSuggestion(null);
      setRefreshCalendar(prev => prev + 1);
      alert('Event rescheduled successfully!');
    } catch (error) {
      console.error('Error applying suggestion:', error);
      alert('Failed to reschedule. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const findEventToDelete = (events, summary, startTime) => {
    return events.find(event => {
      const titleMatch = event.summary?.toLowerCase().includes(summary.toLowerCase());
      if (!titleMatch) return false;
      if (startTime) {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const targetStart = new Date(startTime);
        const timeDiff = Math.abs(eventStart - targetStart);
        return timeDiff < 5 * 60 * 1000;
      }
      return true;
    });
  };

  if (showSplash) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <h1>ALMA</h1>
          <p className="tagline">AI Life Management Assistant</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar 
        isCollapsed={isSidebarCollapsed}
        toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {!isSidebarCollapsed && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarCollapsed(true)} />
      )}

      <div className={`main-content ${isSidebarCollapsed ? 'expanded' : ''}`}>
        {!isAuthenticated ? (
          <div className="login-prompt">
            <p>Please connect your Google Calendar to get started</p>
            <button onClick={handleLogin}>Connect Now</button>
          </div>
        ) : (
          <>
            <div className="voice-container">
              <VoiceAssistant 
                isListening={isVoiceRecording}
                isIdle={!isVoiceRecording}
                onClick={() => {
                  // Trigger the hidden VoiceRecorder button
                  if (voiceRecorderRef.current) {
                    const button = voiceRecorderRef.current.querySelector('button');
                    if (button) {
                      button.click();
                    }
                  }
                }}
                status={isVoiceRecording ? 'Listening...' : 'Tap to speak'}
              />
            </div>

            {/* Hidden VoiceRecorder component - we'll style it to be invisible */}
            <div ref={voiceRecorderRef} style={{ display: 'none' }}>
              <VoiceRecorder 
                onTranscriptionComplete={handleTranscription}
                onRecordingStateChange={setIsVoiceRecording}
              />
            </div>

            {lastTranscription && (
              <div className="transcription-result">
                <h3>I heard:</h3>
                <p>{lastTranscription.transcribedText}</p>
                <h3>Intent:</h3>
                <pre>{JSON.stringify(lastTranscription.intent, null, 2)}</pre>
              </div>
            )}

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
            {activeTab === 'calendar' && (
              <div className="calendar-section">
                <CalendarView refreshTrigger={refreshCalendar} />
              </div>
            )}
            {activeTab === 'shopping' && (
              <div className="shopping-section">
                <ShoppingList refreshTrigger={refreshShopping} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;