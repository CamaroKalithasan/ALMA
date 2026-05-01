import React, { useState, useEffect } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import enUS from 'date-fns/locale/en-US';
import axios from 'axios';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Custom event component to always show title
const EventComponent = ({ event }) => (
  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {event.title}
  </div>
);

const CalendarView = ({ refreshTrigger }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null); // for modal

  useEffect(() => {
    fetchEvents();
  }, [refreshTrigger]);

  const fetchEvents = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/calendar/events`, { withCredentials: true });
      const formattedEvents = response.data.map(event => ({
        id: event.id,
        title: event.summary,
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
        description: event.description,
      }));
      setEvents(formattedEvents);
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  if (loading) return <div>Loading calendar...</div>;

  return (
    <div style={{ height: '650px', width: '100%' }}>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: '100%', width: '100%' }}
        defaultView="week"
        views={['month', 'week', 'day']}
        components={{ event: EventComponent }}
        onSelectEvent={handleSelectEvent}
      />
      {/* Simple Modal Dialog */}
      {selectedEvent && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{selectedEvent.title}</h3>
            <p><strong>Start:</strong> {selectedEvent.start.toLocaleString()}</p>
            <p><strong>End:</strong> {selectedEvent.end.toLocaleString()}</p>
            <p><strong>Description:</strong> {selectedEvent.description || 'No description'}</p>
            <button onClick={closeModal}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;