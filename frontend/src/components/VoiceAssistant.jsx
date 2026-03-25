import React from 'react';
import { Mic, MicOff } from 'lucide-react';

const VoiceAssistant = ({ isListening, isIdle, onClick, status }) => {
  return (
    <div className="voice-assistant" onClick={onClick}>
      <div className={`voice-circle ${isListening ? 'listening' : ''} ${isIdle ? 'idle' : ''}`}>
        <div className="mic-icon">
          {isListening ? <MicOff size={48} /> : <Mic size={48} />}
        </div>
      </div>
      <div className="voice-status">{status}</div>
    </div>
  );
};

export default VoiceAssistant;