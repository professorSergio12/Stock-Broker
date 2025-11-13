import React from 'react';
import { Search, Filter, X } from 'lucide-react';
import './FilterBar.css';

const FilterBar = ({ filters, onFilterChange, stocks = [], exchanges = [], transactionTypes = [], clientIds = [] }) => {
  const handleFilterChange = (key, value) => {
    onFilterChange({ ...filters, [key]: value || undefined });
  };

  const clearFilters = () => {
    onFilterChange({});
  };

  const hasActiveFilters = Object.values(filters).some((value) => value);

  return (
    <div className="filter-bar">
      <div className="filter-header">
        <div className="filter-title">
          <Filter size={20} />
          <h3>Filters</h3>
        </div>
        {hasActiveFilters && (
          <button className="clear-filters" onClick={clearFilters}>
            <X size={16} />
            Clear All
          </button>
        )}
      </div>
      <div className="filter-grid">
        <div className="filter-group">
          <label>Search Security</label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" />
            <select
              value={filters.stockSymbol || ''}
              onChange={(e) => handleFilterChange('stockSymbol', e.target.value)}
              className="filter-select"
            >
              <option value="">All Securities</option>
              {stocks.map((stock) => (
                <option key={stock} value={stock}>
                  {stock}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filter-group">
          <label>Exchange</label>
          <select
            value={filters.exchange || ''}
            onChange={(e) => handleFilterChange('exchange', e.target.value)}
            className="filter-select"
          >
            <option value="">All Exchanges</option>
            {exchanges.map((exchange) => (
              <option key={exchange} value={exchange}>
                {exchange}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Transaction Type</label>
          <select
            value={filters.tradeType || ''}
            onChange={(e) => handleFilterChange('tradeType', e.target.value)}
            className="filter-select"
          >
            <option value="">All Types</option>
            {transactionTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Client ID</label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" />
            <select
              value={filters.customerId || ''}
              onChange={(e) => handleFilterChange('customerId', e.target.value)}
              className="filter-select"
            >
              <option value="">All Clients</option>
              {clientIds.map((clientId) => (
                <option key={clientId} value={clientId}>
                  {clientId}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filter-group">
          <label>Start Date</label>
          <input
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>End Date</label>
          <input
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
            className="filter-input"
          />
        </div>
      </div>
    </div>
  );
};

export default FilterBar;

