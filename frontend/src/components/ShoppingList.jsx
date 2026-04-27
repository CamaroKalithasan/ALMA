import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Trash2, Plus } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// accept refreshTrigger as a prop
const ShoppingList = ({ refreshTrigger }) => {
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    console.log('Fetching items...');
    try {
      const response = await axios.get(`${API_BASE}/api/shopping/list`, { withCredentials: true });
      console.log('Fetched items:', response.data);
      setItems(response.data);
    } catch (err) {
      console.error('Failed to fetch shopping list', err);
    } finally {
      setLoading(false);
    }
  };

  // add refreshTrigger to the dependency array
  useEffect(() => {
    console.log('ShoppingList useEffect, refreshTrigger =', refreshTrigger);
    fetchItems();
  }, [refreshTrigger]);   // <-- now re-fetches when refreshTrigger changes

  const addItem = async () => {
    if (!newItem.trim()) return;
    try {
      const response = await axios.post(`${API_Base}/api/shopping/add`, { itemName: newItem }, { withCredentials: true });
      setItems([response.data, ...items]);
      setNewItem('');
    } catch (err) {
      alert('Failed to add item');
    }
  };

  const deleteItem = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/shopping/remove/${id}`, { withCredentials: true });
      setItems(items.filter(item => item.id !== id));
    } catch (err) {
      alert('Failed to delete item');
    }
  };

  if (loading) return <div className="shopping-container">Loading shopping list...</div>;

  return (
    <div className="shopping-container">
      <div className="shopping-header">
        <h2>Shopping List</h2>
        <div className="add-item-form">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add an item (e.g., milk, eggs)"
            onKeyPress={(e) => e.key === 'Enter' && addItem()}
          />
          <button onClick={addItem}>
            <Plus size={18} />
            Add
          </button>
        </div>
      </div>
      <ul className="shopping-items-list">
        {items.length === 0 && <li className="empty-message">No items yet. Add something!</li>}
        {items.map(item => (
          <li key={item.id}>
            <span>{item.item_name}</span>
            <button onClick={() => deleteItem(item.id)} className="delete-btn">
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ShoppingList;