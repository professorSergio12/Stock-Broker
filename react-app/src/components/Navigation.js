import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, LayoutDashboard } from 'lucide-react';
import './Navigation.css';

const Navigation = () => {
  const location = useLocation();

  return (
    <nav className="navigation-sidebar">
      <div className="navigation-header">
        <h2 className="navigation-title">Menu</h2>
      </div>
      <div className="navigation-items">
        <Link 
          to="/"
          className={`navigation-item ${location.pathname === '/' ? 'active' : ''}`}
        >
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </Link>
        <Link 
          to="/analytics"
          className={`navigation-item ${location.pathname === '/analytics' ? 'active' : ''}`}
        >
          <BarChart3 size={20} />
          <span>Analytics</span>
        </Link>
      </div>
    </nav>
  );
};

export default Navigation;

