import React from 'react';
import { Calendar, ShoppingBag, Menu, X } from 'lucide-react';

const Sidebar = ({ isCollapsed, toggleSidebar, activeTab, setActiveTab }) => {
  return (
    <>
      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <div className="sidebar-logo">
            <h2>ALMA</h2>
          </div>
          <ul className="sidebar-nav">
            <li>
              <a 
                href="#" 
                className={activeTab === 'calendar' ? 'active' : ''}
                onClick={() => setActiveTab('calendar')}
              >
                <Calendar size={20} style={{ marginRight: '12px' }} />
                Calendar
              </a>
            </li>
            <li>
              <a 
                href="#" 
                className={activeTab === 'shopping' ? 'active' : ''}
                onClick={() => setActiveTab('shopping')}
              >
                <ShoppingBag size={20} style={{ marginRight: '12px' }} />
                Shopping List
              </a>
            </li>
          </ul>
        </div>
      </div>
      <button className="sidebar-toggle" onClick={toggleSidebar}>
        {isCollapsed ? <Menu size={20} /> : <X size={20} />}
      </button>
    </>
  );
};

export default Sidebar;