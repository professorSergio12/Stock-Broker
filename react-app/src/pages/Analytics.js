import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { tradesAPI } from '../services/api';
import { ArrowLeft, Filter, XCircle } from 'lucide-react';
import SearchableSelect from '../components/SearchableSelect';
import ClientTradeDetails from '../components/ClientTradeDetails';
import './Analytics.css';

const Analytics = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const [clientIds, setClientIds] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [stocksError, setStocksError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesError, setTradesError] = useState(null);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Fetch stocks when client ID changes
  useEffect(() => {
    if (filters.customerId) {
      fetchStocksForClient();
    } else {
      setStocks([]);
      setStocksError(null);
    }
  }, [filters.customerId]);

  useEffect(() => {
    // Fetch trades when client ID is selected, or when date is selected (even without client ID)
    if (filters.customerId || filters.endDate) {
      fetchClientTrades();
    } else {
      setTrades([]);
      setTradesError(null);
    }
  }, [filters.customerId, filters.endDate, filters.stockName]);

  const fetchFilterOptions = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[Analytics] Fetching client IDs...');
      const startTime = Date.now();
      
      const clientIdsRes = await tradesAPI.getClientIds();
      
      console.log('[Analytics] Raw API response:', clientIdsRes);
      
      // Handle both direct array response and wrapped response
      const clientIdsData = clientIdsRes?.data?.data || clientIdsRes?.data || [];
      
      console.log('[Analytics] Extracted clientIdsData:', clientIdsData);
      console.log('[Analytics] Is array?', Array.isArray(clientIdsData));
      console.log('[Analytics] Length:', clientIdsData?.length);
      
      const sortedClientIds = Array.isArray(clientIdsData) 
        ? [...new Set(clientIdsData)].sort() 
        : [];
      
      const duration = Date.now() - startTime;
      console.log(`[Analytics] Loaded ${sortedClientIds.length} client IDs in ${duration}ms`);
      console.log(`[Analytics] First 5 IDs:`, sortedClientIds.slice(0, 5));
      console.log(`[Analytics] Last 5 IDs:`, sortedClientIds.slice(-5));
      
      if (sortedClientIds.length === 0) {
        setError('No client IDs found. Please check your database connection.');
      }
      
      setClientIds(sortedClientIds);
    } catch (error) {
      console.error('[Analytics] Error fetching filter options:', error);
      console.error('[Analytics] Error response:', error.response);
      console.error('[Analytics] Error details:', error.response?.data || error.message);
      
      const errorMessage = error.response?.data?.message || error.message || 'Failed to fetch client IDs';
      setError(`Error: ${errorMessage}. Please check your backend server and database connection.`);
      setClientIds([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClientIdChange = (value) => {
    // Clear stock filter when client changes
    setFilters({ 
      ...filters, 
      customerId: value || undefined,
      stockName: undefined // Clear stock when client changes
    });
  };

  const handleDateChange = (value) => {
    setFilters({ 
      ...filters, 
      endDate: value || undefined 
    });
  };

  const fetchStocksForClient = async () => {
    if (!filters.customerId) {
      setStocks([]);
      return;
    }

    try {
      setStocksLoading(true);
      setStocksError(null);
      
      console.log('[Analytics] Fetching stocks for client:', filters.customerId);
      
      const response = await tradesAPI.getStocksByClientId(filters.customerId);
      
      const stocksData = response?.data?.data || response?.data || [];
      
      console.log(`[Analytics] Fetched ${stocksData.length} unique stocks for client ${filters.customerId}`);
      
      setStocks(stocksData);
    } catch (error) {
      console.error('[Analytics] Error fetching stocks for client:', error);
      setStocksError(error.response?.data?.message || error.message || 'Failed to fetch stocks');
      setStocks([]);
    } finally {
      setStocksLoading(false);
    }
  };

  const clearFilters = () => {
    const newFilters = { ...filters };
    delete newFilters.customerId;
    delete newFilters.endDate;
    delete newFilters.stockName;
    setFilters(newFilters);
    setStocks([]);
  };

  const fetchClientTrades = async () => {
    // Allow fetching with just date filter (no client ID required)
    if (!filters.customerId && !filters.endDate) {
      setTrades([]);
      return;
    }

    try {
      setTradesLoading(true);
      setTradesError(null);
      
      console.log('[Analytics] Fetching trades...');
      console.log('[Analytics] Filters:', { 
        customerId: filters.customerId, 
        endDate: filters.endDate,
        stockName: filters.stockName 
      });
      
      // Fetch all trades for this client (with pagination if needed)
      const allTrades = [];
      let page = 1;
      let hasMore = true;
      const limit = 200; // Max allowed by backend
      
      while (hasMore) {
        const requestParams = {
          customerId: filters.customerId,
          page: page,
          limit: limit,
        };
        
        // Only add endDate if it's provided
        if (filters.endDate) {
          requestParams.endDate = filters.endDate;
        }
        
        // Only add stockName if it's provided
        if (filters.stockName) {
          requestParams.stockSymbol = filters.stockName;
        }
        
        console.log(`[Analytics] Fetching page ${page} with params:`, requestParams);
        
        const response = await tradesAPI.getTrades(requestParams);
        
        console.log(`[Analytics] API response for page ${page}:`, {
          hasData: !!response?.data,
          dataLength: response?.data?.data?.length || 0,
          pagination: response?.data?.pagination
        });
        
        const apiResponse = response?.data || {};
        const rows = apiResponse.data || [];
        const pagination = apiResponse.pagination || {};
        
        console.log(`[Analytics] Page ${page}: Got ${rows.length} rows, total: ${pagination.total}, pages: ${pagination.pages}`);
        
        if (rows && rows.length > 0) {
          allTrades.push(...rows);
          console.log(`[Analytics] Page ${page}: Added ${rows.length} rows, total so far: ${allTrades.length}`);
        } else {
          console.log(`[Analytics] Page ${page}: No rows returned`);
        }
        
        // Check if there are more pages
        if (pagination.pages && page < pagination.pages) {
          page++;
        } else {
          hasMore = false;
          console.log(`[Analytics] No more pages. Total pages: ${pagination.pages}, current page: ${page}`);
        }
        
        // Safety limit
        if (page > 100) {
          console.warn('[Analytics] Reached safety limit of 100 pages');
          hasMore = false;
        }
      }
      
      console.log(`[Analytics] ===== FINAL RESULT =====`);
      const filterDesc = filters.customerId 
        ? `client ${filters.customerId}${filters.endDate ? ` up to ${filters.endDate}` : ''}`
        : `up to date ${filters.endDate}`;
      console.log(`[Analytics] Total trades fetched: ${allTrades.length} for ${filterDesc}`);
      if (allTrades.length > 0) {
        console.log(`[Analytics] First trade:`, allTrades[0]);
        console.log(`[Analytics] Last trade:`, allTrades[allTrades.length - 1]);
      }
      console.log(`[Analytics] ========================`);
      
      setTrades(allTrades);
    } catch (error) {
      console.error('[Analytics] Error fetching client trades:', error);
      console.error('[Analytics] Error response:', error.response);
      console.error('[Analytics] Error data:', error.response?.data);
      setTradesError(error.response?.data?.message || error.message || 'Failed to fetch trades');
      setTrades([]);
    } finally {
      setTradesLoading(false);
    }
  };

  const hasActiveFilters = filters.customerId || filters.endDate;

  return (
    <div className="analytics-page">
      <div className="analytics-page-header">
        <button 
          className="back-to-dashboard-btn"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </button>
        <div className="analytics-page-title">
          <Filter size={24} />
          <h1>Analytics Filters</h1>
        </div>
      </div>

      <div className="analytics-page-content">
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading filters...</p>
          </div>
        ) : (
          <div className="analytics-filters-container">
            <div className="filter-section">
              <div className="filter-label-wrapper">
                <Filter size={18} />
                <label className="filter-label">Filters</label>
              </div>

              {/* Client ID Filter */}
              <div className="filter-group">
                {loading ? (
                  <div>
                    <label htmlFor="analytics-client-id" className="filter-input-label">
                      Client ID
                    </label>
                    <div className="filter-select" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                      Loading client IDs...
                    </div>
                    <p className="filter-description">
                      Fetching client IDs from database...
                    </p>
                  </div>
                ) : error ? (
                  <div>
                    <label htmlFor="analytics-client-id" className="filter-input-label">
                      Client ID
                    </label>
                    <div className="filter-select" style={{ borderColor: '#e53e3e', color: '#e53e3e' }}>
                      Error loading client IDs
                    </div>
                    <p className="filter-description" style={{ color: '#e53e3e' }}>
                      {error}
                    </p>
                    <button 
                      onClick={fetchFilterOptions}
                      style={{
                        marginTop: '8px',
                        padding: '8px 16px',
                        background: '#667eea',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <SearchableSelect
                    id="analytics-client-id"
                    label="Client ID"
                    value={filters.customerId || ''}
                    onChange={handleClientIdChange}
                    options={clientIds}
                    placeholder="All Clients"
                    searchPlaceholder="Search client ID..."
                    description="Select a client ID to view all stock details for that specific client"
                    countText={clientIds.length > 0 ? `${clientIds.length} client${clientIds.length !== 1 ? 's' : ''} available` : 'No client IDs found'}
                  />
                )}
              </div>

              {/* Date Filter */}
              <div className="filter-group">
                <label htmlFor="analytics-date" className="filter-input-label">
                  Filter by Date
                </label>
                <input
                  id="analytics-date"
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="filter-input"
                  placeholder="Select date"
                />
                <p className="filter-description">
                  Select a date to show all stock sell and purchase transactions up to and including this date
                </p>
              </div>

              {/* Stock Filter - Only show when a client is selected */}
              {filters.customerId && (
                <div className="filter-group">
                  <label htmlFor="analytics-stock" className="filter-input-label">
                    Filter by Stock
                  </label>
                  {stocksLoading ? (
                    <div className="filter-select" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                      Loading stocks...
                    </div>
                  ) : stocksError ? (
                    <div className="filter-select" style={{ borderColor: '#e53e3e', color: '#e53e3e' }}>
                      Error loading stocks
                    </div>
                  ) : (
                    <SearchableSelect
                      id="analytics-stock"
                      value={filters.stockName || ''}
                      onChange={(value) => setFilters({ ...filters, stockName: value || undefined })}
                      options={stocks}
                      placeholder="All Stocks"
                      searchPlaceholder="Search stock name..."
                      description={`Select a stock to filter trades. ${stocks.length} stock${stocks.length !== 1 ? 's' : ''} available for this client.`}
                      countText={stocks.length > 0 ? `${stocks.length} stock${stocks.length !== 1 ? 's' : ''} available` : 'No stocks found'}
                    />
                  )}
                </div>
              )}

              {/* Clear Button */}
              {hasActiveFilters && (
                <button 
                  className="clear-filters-btn"
                  onClick={clearFilters}
                >
                  <XCircle size={16} />
                  Clear All Filters
                </button>
              )}

              {/* Active Filters Display */}
              {hasActiveFilters && (
                <div className="active-filters">
                  <h4 className="active-filters-title">Active Filters:</h4>
                  <div className="active-filters-list">
                    {filters.customerId && (
                      <span className="active-filter-badge">
                        Client ID: {filters.customerId}
                      </span>
                    )}
                    {filters.endDate && (
                      <span className="active-filter-badge">
                        Date: {new Date(filters.endDate).toLocaleDateString('en-IN')}
                      </span>
                    )}
                    {filters.stockName && (
                      <span className="active-filter-badge">
                        Stock: {filters.stockName}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Client Trade Details */}
        {(filters.customerId || filters.endDate) && (
          <div className="client-trades-section">
            {tradesError ? (
              <div className="trades-error">
                <p style={{ color: '#e53e3e', margin: '20px 0' }}>
                  Error loading trades: {tradesError}
                </p>
                <button 
                  onClick={fetchClientTrades}
                  style={{
                    padding: '8px 16px',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Retry
                </button>
              </div>
            ) : (
              <ClientTradeDetails 
                trades={trades}
                loading={tradesLoading}
                clientId={filters.customerId}
                endDate={filters.endDate}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;

