'use strict';

const DEFAULT_TABLE = 'Transaction';

function sanitizeIdentifier(identifier) {
	return String(identifier).replace(/[^a-zA-Z0-9_]/g, '');
}

function buildWhereClause(filters, params, tableName = DEFAULT_TABLE) {
	const conditions = [];

	// Map allowed filters: query param -> column name
	const filterMap = {
		ws_client_id: 'WS_client_id',
		ws_account_code: 'WS_Account_code',
		trandate_from: 'TRANDATE',
		trandate_to: 'TRANDATE',
		setdate_from: 'SETDATE',
		setdate_to: 'SETDATE',
		tran_type: 'Tran_Type',
		tran_desc: 'Tran_Desc',
		security_type: 'Security_Type',
		security_type_description: 'Security_Type_Description',
		detailtypename: 'DETAILTYPENAME',
		isin: 'ISIN',
		security_code: 'Security_code',
		security_name: 'Security_Name',
		exchg: 'EXCHG',
		brokercode: 'BROKERCODE',
		portfolioid: 'PORTFOLIOID',
		branchid: 'BRANCHID',
		ownerid: 'OWNERID',
		advisorid: 'ADVISORID',
		groupid: 'GROUPID'
	};

	// Equality filters
	Object.entries(filterMap).forEach(([key, column]) => {
		if (filters[key] && !key.endsWith('_from') && !key.endsWith('_to')) {
			// For client ID, use table prefix and direct value (not parameterized) to match console format
			if (key === 'ws_client_id') {
				const clientIdValue = String(filters[key]).trim();
				// Use table prefix format: Transaction.WS_client_id = 8800001 (direct value, not parameterized)
				// This matches the working console query format
				if (/^\d+$/.test(clientIdValue)) {
					const numValue = parseInt(clientIdValue, 10);
					// Use direct value insertion for numeric client IDs (matches console format)
					conditions.push(`${tableName}.${column} = ${numValue}`);
					// Don't add to params since we're using direct value
				} else {
					// For non-numeric, use parameterized
					conditions.push(`${tableName}.${column} = ?`);
					params.push(clientIdValue);
				}
			} else if (key === 'security_name') {
				// For Security_Name, embed directly in query with single quotes (like dates)
				// ZCQL requires: Security_Name='Stock Name' (not parameterized)
				// Based on working query: SELECT * from Transaction where Transaction.WS_client_id=8800001 AND Security_Name='Shree Cement Limited'
				const stockName = String(filters[key]).trim();
				// Escape single quotes in stock name by doubling them
				const escapedStockName = stockName.replace(/'/g, "''");
				conditions.push(`${column} = '${escapedStockName}'`);
				// Don't add to params since we're embedding directly
				console.log(`[buildWhereClause] Stock filter (security_name): "${stockName}"`);
			} else if (key === 'security_code') {
				// For Security_code, embed directly in query with single quotes (like dates)
				// ZCQL requires: Security_code='STOCKCODE' (not parameterized)
				const stockCode = String(filters[key]).trim();
				// Escape single quotes in stock code by doubling them
				const escapedStockCode = stockCode.replace(/'/g, "''");
				conditions.push(`${column} = '${escapedStockCode}'`);
				// Don't add to params since we're embedding directly
				console.log(`[buildWhereClause] Stock filter (security_code): "${stockCode}"`);
			} else if (key === 'exchg') {
				// For EXCHG, embed directly in query with single quotes (like dates)
				// ZCQL requires: EXCHG='NSE' (not parameterized)
				const exchange = String(filters[key]).trim();
				// Escape single quotes in exchange by doubling them
				const escapedExchange = exchange.replace(/'/g, "''");
				conditions.push(`${column} = '${escapedExchange}'`);
				// Don't add to params since we're embedding directly
				console.log(`[buildWhereClause] Exchange filter (exchg): "${exchange}"`);
			} else {
				conditions.push(`${column} = ?`);
				params.push(filters[key]);
			}
		}
	});

	// Date range filters (ZCQL v2 requires dates in single quotes, not as parameters)
	// Format: 'YYYY-MM-DD' - embed directly in query string for ZCQL v2 compatibility
	if (filters.trandate_from) {
		// Validate and sanitize date format (YYYY-MM-DD)
		const dateFrom = String(filters.trandate_from).trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
			// Embed date directly in query with single quotes (ZCQL v2 requirement)
			conditions.push(`TRANDATE >= '${dateFrom}'`);
			console.log(`[buildWhereClause] Date filter (trandate_from): ${dateFrom}`);
		} else {
			console.warn(`[buildWhereClause] Invalid date format for trandate_from: ${dateFrom}`);
		}
	}
	if (filters.trandate_to) {
		// Date filter: show all trades up to and including the selected date
		// ZCQL v2 requires date values in single quotes: 'YYYY-MM-DD'
		const dateTo = String(filters.trandate_to).trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
			// Embed date directly in query with single quotes (ZCQL v2 requirement)
			conditions.push(`TRANDATE <= '${dateTo}'`);
			console.log(`[buildWhereClause] Date filter (trandate_to): ${dateTo}`);
		} else {
			console.warn(`[buildWhereClause] Invalid date format for trandate_to: ${dateTo}`);
		}
	}
	if (filters.setdate_from) {
		const dateFrom = String(filters.setdate_from).trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
			conditions.push(`SETDATE >= '${dateFrom}'`);
		} else {
			console.warn(`[buildWhereClause] Invalid date format for setdate_from: ${dateFrom}`);
		}
	}
	if (filters.setdate_to) {
		const dateTo = String(filters.setdate_to).trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
			conditions.push(`SETDATE <= '${dateTo}'`);
		} else {
			console.warn(`[buildWhereClause] Invalid date format for setdate_to: ${dateTo}`);
		}
	}

	// Free-text search on Security_Name
	if (filters.q) {
		conditions.push(`(Security_Name LIKE ? OR Security_code LIKE ?)`);
		const like = `%${filters.q}%`;
		params.push(like, like);
	}

	if (conditions.length === 0) {
		return '';
	}
	return ' WHERE ' + conditions.join(' AND ');
}

exports.listStocks = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}

		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);

		const page = Math.max(parseInt(req.query.page || '1', 10), 1);
		const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
		const offset = (page - 1) * limit;

		const params = [];
		const where = buildWhereClause(req.query, params, tableName);

		// Order by TRANDATE desc by default (use table prefix)
		const orderBy = ` ORDER BY ${tableName}.TRANDATE DESC`;

		const query = `select * from ${tableName}${where}${orderBy} limit ${limit} offset ${offset}`;

		// Log query details for debugging (client ID, date, and stock filters)
		if (req.query.ws_client_id || req.query.trandate_to || req.query.security_name) {
			console.log(`[listStocks] ===== QUERY DEBUG =====`);
			if (req.query.ws_client_id) {
				console.log(`[listStocks] Client ID from request: "${req.query.ws_client_id}"`);
			}
			if (req.query.trandate_to) {
				console.log(`[listStocks] Date filter (trandate_to): "${req.query.trandate_to}"`);
			}
			if (req.query.security_name) {
				console.log(`[listStocks] Stock filter (security_name): "${req.query.security_name}"`);
			}
			console.log(`[listStocks] WHERE clause: ${where}`);
			console.log(`[listStocks] Params:`, params);
			console.log(`[listStocks] Full query: ${query}`);
			
			// Test the exact query format that works in console
			try {
				const testZcql = app.zcql();
				const clientIdValue = String(req.query.ws_client_id).trim();
				
				// Test with exact format from console: Transaction.WS_client_id = number
				if (/^\d+$/.test(clientIdValue)) {
					const numValue = parseInt(clientIdValue, 10);
					const testQuery = `select * from ${tableName} where ${tableName}.WS_client_id = ${numValue} limit 5`;
					console.log(`[listStocks] Testing exact console format: ${testQuery}`);
					const testRows = await testZcql.executeZCQLQuery(testQuery, []);
					console.log(`[listStocks] Test query returned ${testRows ? testRows.length : 0} rows`);
					if (testRows && testRows.length > 0) {
						console.log(`[listStocks] First test row:`, testRows[0]);
					}
				}
			} catch (testErr) {
				console.error(`[listStocks] Test query error:`, testErr.message);
			}
			console.log(`[listStocks] =================================`);
		}

		const zcql = app.zcql();
		let rows;
		try {
			rows = await zcql.executeZCQLQuery(query, params);
		} catch (queryErr) {
			console.error(`[listStocks] Query execution error:`, queryErr);
			console.error(`[listStocks] Query that failed: ${query}`);
			console.error(`[listStocks] Params that failed:`, params);
			throw queryErr;
		}
		
		if (req.query.ws_client_id || req.query.trandate_to) {
			const filterDesc = req.query.ws_client_id 
				? `client ${req.query.ws_client_id}${req.query.trandate_to ? ` up to ${req.query.trandate_to}` : ''}`
				: `up to date ${req.query.trandate_to}`;
			console.log(`[listStocks] Main query returned ${rows ? rows.length : 0} rows for ${filterDesc}`);
			if (rows && rows.length > 0) {
				console.log(`[listStocks] First row sample:`, rows[0]);
			}
		}

		// Count query for total (optional; can be heavy on large tables)
		let total = null;
		try {
			const countQuery = `select count(ROWID) as total_count from ${tableName}${where}`;
			const countRows = await zcql.executeZCQLQuery(countQuery, params);
			if (countRows && countRows.length > 0) {
				// SDK returns objects wrapped under table alias sometimes; normalize
				const first = countRows[0];
				// Try multiple shapes
				const nested = first[tableName] || first['Transaction'];
				total =
					Number(first.total_count) ||
					Number(first['total_count']) ||
					Number(first.count) ||
					Number(first['COUNT']) ||
					Number(first['COUNT(ROWID)']) ||
					(nested ? (
						Number(nested.total_count) ||
						Number(nested['total_count']) ||
						Number(nested.count) ||
						Number(nested['COUNT']) ||
						Number(nested['COUNT(ROWID)'])
					) : 0) ||
					0;
			}
		} catch (e) {
			// Ignore count failure, still return data
		}

		return res.status(200).json({
			page,
			limit,
			total,
			data: rows
		});
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch stocks', error: String(err && err.message ? err.message : err) });
	}
};

exports.getStockById = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const rowId = req.params.id;

		const zcql = app.zcql();
		const query = `select * from ${tableName} where ROWID = ?`;
		const rows = await zcql.executeZCQLQuery(query, [rowId]);

		if (!rows || rows.length === 0) {
			return res.status(404).json({ message: 'Not found' });
		}
		return res.status(200).json(rows[0]);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch stock', error: String(err && err.message ? err.message : err) });
	}
};

exports.getStats = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();

		// Reuse filter builder
		const params = [];
		const where = buildWhereClause(req.query, params, tableName);

		// Overall totals
		const totalsQ = `select count(ROWID) as total_trades, sum(Net_Amount) as total_net_amount from ${tableName}${where}`;
		let totalsRows;
		try {
			totalsRows = await zcql.executeZCQLQuery(totalsQ, params);
		} catch (err) {
			console.error('Totals query error:', err);
			throw new Error(`Totals query failed: ${err.message}`);
		}
		const totals = totalsRows && totalsRows[0] ? totalsRows[0] : {};
		
		// Extract from wrapped result if needed
		const totalTrades = Number(totals.total_trades || totals[`${tableName}.total_trades`] || 0);
		const totalNetAmount = Number(totals.total_net_amount || totals[`${tableName}.total_net_amount`] || 0);

		// Buy / Sell counts - use simple pattern matching (ZCQL may not support LOWER)
		const buyWhere = where ? `${where} AND Tran_Type LIKE ?` : ` WHERE Tran_Type LIKE ?`;
		const sellWhere = where ? `${where} AND Tran_Type LIKE ?` : ` WHERE Tran_Type LIKE ?`;
		const buyParams = params.slice().concat(['B%']); // Clone params array and add pattern
		const sellParams = params.slice().concat(['S%']);
		
		// Also try lowercase patterns
		const buyParams2 = params.slice().concat(['b%']);
		const sellParams2 = params.slice().concat(['s%']);

		let buyTrades = 0;
		let sellTrades = 0;
		try {
			const buyQ = `select count(ROWID) as c from ${tableName}${buyWhere}`;
			const sellQ = `select count(ROWID) as c from ${tableName}${sellWhere}`;
			
			// Try uppercase first, then lowercase
			try {
				const [buyRows, sellRows] = await Promise.all([
					zcql.executeZCQLQuery(buyQ, buyParams),
					zcql.executeZCQLQuery(sellQ, sellParams)
				]);
				buyTrades = Number((buyRows && buyRows[0] && (buyRows[0].c || buyRows[0][`${tableName}.c`])) || 0);
				sellTrades = Number((sellRows && sellRows[0] && (sellRows[0].c || sellRows[0][`${tableName}.c`])) || 0);
			} catch (err) {
				// Fallback to lowercase
				const [buyRows2, sellRows2] = await Promise.all([
					zcql.executeZCQLQuery(buyQ, buyParams2),
					zcql.executeZCQLQuery(sellQ, sellParams2)
				]);
				buyTrades = Number((buyRows2 && buyRows2[0] && (buyRows2[0].c || buyRows2[0][`${tableName}.c`])) || 0);
				sellTrades = Number((sellRows2 && sellRows2[0] && (sellRows2[0].c || sellRows2[0][`${tableName}.c`])) || 0);
			}
		} catch (err) {
			console.error('Buy/Sell query error:', err);
			// Continue with 0 values
		}

		// Completed trades (payment date present)
		let completedTrades = 0;
		try {
			const completedWhere = where ? `${where} AND PAYMENTDATE is not null` : ` WHERE PAYMENTDATE is not null`;
			const completedQ = `select count(ROWID) as c from ${tableName}${completedWhere}`;
			const completedRows = await zcql.executeZCQLQuery(completedQ, params);
			completedTrades = Number((completedRows && completedRows[0] && (completedRows[0].c || completedRows[0][`${tableName}.c`])) || 0);
		} catch (err) {
			console.error('Completed query error:', err);
			// Continue with 0
		}

		// Top 10 stocks by value
		let topStocks = [];
		try {
			const topStocksQ = `select Security_Name as _id, count(ROWID) as tradeCount, sum(Net_Amount) as totalValue, sum(QTY) as totalQuantity from ${tableName}${where} group by Security_Name order by sum(Net_Amount) desc limit 10`;
			const topStocksRows = await zcql.executeZCQLQuery(topStocksQ, params);
			topStocks = (topStocksRows || []).map(row => ({
				_id: row._id || row.Security_Name || row[`${tableName}.Security_Name`],
				tradeCount: Number(row.tradeCount || row[`${tableName}.tradeCount`] || 0),
				totalValue: Number(row.totalValue || row[`${tableName}.totalValue`] || 0),
				totalQuantity: Number(row.totalQuantity || row[`${tableName}.totalQuantity`] || 0)
			}));
		} catch (err) {
			console.error('Top stocks query error:', err);
			// Return empty array
		}

		// Exchange distribution
		let exchangeStats = [];
		try {
			const exchgQ = `select EXCHG as _id, count(ROWID) as count, sum(Net_Amount) as totalValue from ${tableName}${where} group by EXCHG`;
			const exchgRows = await zcql.executeZCQLQuery(exchgQ, params);
			exchangeStats = (exchgRows || []).map(row => ({
				_id: row._id || row.EXCHG || row[`${tableName}.EXCHG`],
				count: Number(row.count || row[`${tableName}.count`] || 0),
				totalValue: Number(row.totalValue || row[`${tableName}.totalValue`] || 0)
			}));
		} catch (err) {
			console.error('Exchange stats query error:', err);
			// Return empty array
		}

		// Daily volume (last 30 days) - with buy/sell breakdown
		let dailyVolume = [];
		try {
			const dailyQ = `select TRANDATE as _id, count(ROWID) as count, sum(Net_Amount) as totalValue from ${tableName}${where} group by TRANDATE order by TRANDATE desc limit 30`;
			const dailyRows = await zcql.executeZCQLQuery(dailyQ, params);
			
			// For each date, get buy and sell counts
			const dailyVolumeWithBuySell = await Promise.all((dailyRows || []).map(async (row) => {
				const date = row._id || row.TRANDATE || row[`${tableName}.TRANDATE`];
				const dateWhere = where ? `${where} AND TRANDATE = ?` : ` WHERE TRANDATE = ?`;
				const dateParams = params.slice().concat([date]);
				
				let buyCount = 0;
				let sellCount = 0;
				
				try {
					const buyWhere = dateWhere + ` AND Tran_Type LIKE ?`;
					const sellWhere = dateWhere + ` AND Tran_Type LIKE ?`;
					const buyParams = dateParams.slice().concat(['B%']);
					const sellParams = dateParams.slice().concat(['S%']);
					
					const [buyRows, sellRows] = await Promise.all([
						zcql.executeZCQLQuery(`select count(ROWID) as c from ${tableName}${buyWhere}`, buyParams),
						zcql.executeZCQLQuery(`select count(ROWID) as c from ${tableName}${sellWhere}`, sellParams)
					]);
					
					buyCount = Number((buyRows && buyRows[0] && (buyRows[0].c || buyRows[0][`${tableName}.c`])) || 0);
					sellCount = Number((sellRows && sellRows[0] && (sellRows[0].c || sellRows[0][`${tableName}.c`])) || 0);
					
					// Try lowercase if uppercase didn't work
					if (buyCount === 0 && sellCount === 0) {
						const buyParams2 = dateParams.slice().concat(['b%']);
						const sellParams2 = dateParams.slice().concat(['s%']);
						const [buyRows2, sellRows2] = await Promise.all([
							zcql.executeZCQLQuery(`select count(ROWID) as c from ${tableName}${buyWhere}`, buyParams2),
							zcql.executeZCQLQuery(`select count(ROWID) as c from ${tableName}${sellWhere}`, sellParams2)
						]);
						buyCount = Number((buyRows2 && buyRows2[0] && (buyRows2[0].c || buyRows2[0][`${tableName}.c`])) || 0);
						sellCount = Number((sellRows2 && sellRows2[0] && (sellRows2[0].c || sellRows2[0][`${tableName}.c`])) || 0);
					}
				} catch (err) {
					console.error(`Error getting buy/sell for date ${date}:`, err);
				}
				
				return {
					_id: date,
					count: Number(row.count || row[`${tableName}.count`] || 0),
					totalValue: Number(row.totalValue || row[`${tableName}.totalValue`] || 0),
					buyTrades: buyCount,
					sellTrades: sellCount
				};
			}));
			
			dailyVolume = dailyVolumeWithBuySell.reverse(); // Reverse to show oldest first
		} catch (err) {
			console.error('Daily volume query error:', err);
			// Return empty array
		}

		return res.status(200).json({
			overall: {
				totalTrades,
				totalNetAmount,
				avgTradeValue: totalTrades > 0 ? Math.round(totalNetAmount / totalTrades) : 0,
				buyTrades,
				sellTrades,
				completedTrades
			},
			topStocks,
			exchangeStats,
			dailyVolume
		});
	} catch (err) {
		console.error('Stats endpoint error:', err);
		return res.status(500).json({ 
			message: 'Failed to fetch stats', 
			error: String(err && err.message ? err.message : err),
			stack: err.stack
		});
	}
};

exports.getExchanges = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();
		const query = `select distinct EXCHG from ${tableName} where EXCHG is not null`;
		const rows = await zcql.executeZCQLQuery(query, []);
		// Handle different ZCQL result formats
		const data = rows.map(r => {
			return r.EXCHG || 
			       r[`${tableName}.EXCHG`] || 
			       (r[tableName] && r[tableName].EXCHG) ||
			       (r.Transaction && r.Transaction.EXCHG);
		}).filter(Boolean);
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch exchanges', error: String(err && err.message ? err.message : err) });
	}
};

exports.getTransactionTypes = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();
		const query = `select distinct Tran_Type from ${tableName} where Tran_Type is not null`;
		const rows = await zcql.executeZCQLQuery(query, []);
		const data = rows.map(r => r.Tran_Type).filter(Boolean);
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch transaction types', error: String(err && err.message ? err.message : err) });
	}
};

exports.getClientIds = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			console.error('[getClientIds] Catalyst app context missing');
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		console.log(`[getClientIds] Using table: ${tableName}`);
		
		const zcql = app.zcql();
		const allClientIds = new Set();
		
		// Strategy: Fetch ALL rows in batches (NO DISTINCT/GROUP BY to avoid limits)
		// Then deduplicate in memory using Set
		// ZCQL has a hard limit of 300 rows in LIMIT clause, so we use 250 to be safe
		const batchSize = 250; // Fetch 250 rows per batch (ZCQL max is 300)
		let offset = 0;
		let hasMore = true;
		let totalRowsFetched = 0;
		let batchNumber = 0;
		
		console.log(`[getClientIds] Starting pagination approach - fetching ALL rows in batches...`);
		console.log(`[getClientIds] Will deduplicate in memory using Set`);
		
		// Fetch all rows in batches until we get no more results
		while (hasMore) {
			batchNumber++;
			
			// Simple SELECT query WITHOUT DISTINCT or GROUP BY
			// Just fetch rows with client IDs, ordered for consistency
			const query = `select WS_client_id from ${tableName} where WS_client_id is not null order by WS_client_id limit ${batchSize} offset ${offset}`;
			
			try {
				console.log(`[getClientIds] Batch ${batchNumber}: Fetching rows with offset ${offset}...`);
				const rows = await zcql.executeZCQLQuery(query, []);
				
				if (!rows || rows.length === 0) {
					console.log(`[getClientIds] Batch ${batchNumber}: No more rows at offset ${offset}`);
					hasMore = false;
					break;
				}
				
				totalRowsFetched += rows.length;
				
				// Extract client IDs and add to Set (automatically deduplicates)
				let batchUniqueCount = 0;
				rows.forEach(row => {
					// Handle different ZCQL result formats
					const clientId = row.WS_client_id || 
					                 row[`${tableName}.WS_client_id`] || 
					                 (row[tableName] && row[tableName].WS_client_id) ||
					                 (row.Transaction && row.Transaction.WS_client_id);
					if (clientId && String(clientId).trim() !== '') {
						const trimmedId = String(clientId).trim();
						const beforeSize = allClientIds.size;
						allClientIds.add(trimmedId);
						if (allClientIds.size > beforeSize) {
							batchUniqueCount++;
						}
					}
				});
				
				console.log(`[getClientIds] Batch ${batchNumber}: Fetched ${rows.length} rows, ${batchUniqueCount} new unique IDs, total unique so far: ${allClientIds.size}, total rows processed: ${totalRowsFetched}`);
				
				// If we got fewer rows than batchSize, we've reached the end
				if (rows.length < batchSize) {
					hasMore = false;
					console.log(`[getClientIds] Batch ${batchNumber}: Reached end of data (got ${rows.length} < ${batchSize} rows)`);
				} else {
					offset += batchSize;
					// Safety limit to prevent infinite loops
					if (offset > 1000000) {
						console.warn(`[getClientIds] Reached safety limit of 1M rows, stopping`);
						hasMore = false;
					}
				}
			} catch (batchErr) {
				console.error(`[getClientIds] Batch ${batchNumber} error at offset ${offset}:`, batchErr.message);
				
				// If OFFSET fails on first batch, try without OFFSET
				if (offset === 0) {
					console.log(`[getClientIds] First batch with OFFSET failed, trying without OFFSET...`);
					try {
						const simpleQuery = `select WS_client_id from ${tableName} where WS_client_id is not null limit ${batchSize}`;
						const simpleRows = await zcql.executeZCQLQuery(simpleQuery, []);
						
						if (simpleRows && simpleRows.length > 0) {
							totalRowsFetched += simpleRows.length;
							let batchUniqueCount = 0;
							simpleRows.forEach(row => {
								const clientId = row.WS_client_id || 
								                 row[`${tableName}.WS_client_id`] || 
								                 (row[tableName] && row[tableName].WS_client_id) ||
								                 (row.Transaction && row.Transaction.WS_client_id);
								if (clientId && String(clientId).trim() !== '') {
									const trimmedId = String(clientId).trim();
									const beforeSize = allClientIds.size;
									allClientIds.add(trimmedId);
									if (allClientIds.size > beforeSize) {
										batchUniqueCount++;
									}
								}
							});
							console.log(`[getClientIds] Simple query (no OFFSET) returned ${simpleRows.length} rows, ${batchUniqueCount} new unique IDs, total unique: ${allClientIds.size}`);
						}
					} catch (simpleErr) {
						console.error(`[getClientIds] Simple query also failed:`, simpleErr.message);
					}
				}
				hasMore = false;
			}
		}
		
		// Convert Set to sorted array
		const uniqueData = Array.from(allClientIds).sort();
		
		console.log(`[getClientIds] ===== FINAL RESULT =====`);
		console.log(`[getClientIds] Total batches processed: ${batchNumber}`);
		console.log(`[getClientIds] Total rows fetched: ${totalRowsFetched}`);
		console.log(`[getClientIds] Total unique client IDs: ${uniqueData.length}`);
		console.log(`[getClientIds] First 5 IDs:`, uniqueData.slice(0, 5));
		console.log(`[getClientIds] Last 5 IDs:`, uniqueData.slice(-5));
		console.log(`[getClientIds] ========================`);
		
		if (uniqueData.length === 0) {
			console.warn(`[getClientIds] WARNING: No client IDs found! Check if table has data.`);
		} else if (uniqueData.length < 100) {
			console.warn(`[getClientIds] WARNING: Only found ${uniqueData.length} unique IDs. Expected more. Check if pagination is working correctly.`);
		}
		
		return res.status(200).json(uniqueData);
	} catch (err) {
		console.error('[getClientIds] Fatal error:', err);
		console.error('[getClientIds] Error details:', err.message);
		console.error('[getClientIds] Error stack:', err.stack);
		return res.status(500).json({ 
			message: 'Failed to fetch client ids', 
			error: String(err && err.message ? err.message : err),
			details: err.toString()
		});
	}
};

exports.getSymbols = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();
		const query = `select distinct Security_code from ${tableName} where Security_code is not null`;
		const rows = await zcql.executeZCQLQuery(query, []);
		// Handle different ZCQL result formats
		const data = rows.map(r => {
			return r.Security_code || 
			       r[`${tableName}.Security_code`] || 
			       (r[tableName] && r[tableName].Security_code) ||
			       (r.Transaction && r.Transaction.Security_code);
		}).filter(Boolean);
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch symbols', error: String(err && err.message ? err.message : err) });
	}
};

// Get unique stocks (Security_Name) for a specific client ID
exports.getStocksByClientId = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			console.error('[getStocksByClientId] Catalyst app context missing');
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		
		const clientId = req.query.clientId || req.query.ws_client_id;
		if (!clientId) {
			return res.status(400).json({ message: 'Client ID is required' });
		}
		
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		console.log(`[getStocksByClientId] Fetching stocks for client ID: ${clientId}`);
		
		const zcql = app.zcql();
		const allStocks = new Set();
		
		// Strategy: Fetch ALL rows for this client in batches, then deduplicate stock names
		const batchSize = 250; // ZCQL max is 300, use 250 to be safe
		let offset = 0;
		let hasMore = true;
		let totalRowsFetched = 0;
		let batchNumber = 0;
		
		// Validate client ID is numeric (for direct value insertion)
		const clientIdValue = String(clientId).trim();
		if (!/^\d+$/.test(clientIdValue)) {
			return res.status(400).json({ message: 'Invalid client ID format' });
		}
		const numClientId = parseInt(clientIdValue, 10);
		
		console.log(`[getStocksByClientId] Starting pagination approach for client ${numClientId}...`);
		
		// Fetch all rows for this client in batches
		while (hasMore) {
			batchNumber++;
			
			// Query to get Security_Name for this client
			// Use direct value insertion for client ID (matches working format)
			const query = `select Security_Name from ${tableName} where ${tableName}.WS_client_id = ${numClientId} and Security_Name is not null order by Security_Name limit ${batchSize} offset ${offset}`;
			
			try {
				console.log(`[getStocksByClientId] Batch ${batchNumber}: Fetching rows with offset ${offset}...`);
				const rows = await zcql.executeZCQLQuery(query, []);
				
				if (!rows || rows.length === 0) {
					console.log(`[getStocksByClientId] Batch ${batchNumber}: No more rows at offset ${offset}`);
					hasMore = false;
					break;
				}
				
				totalRowsFetched += rows.length;
				
				// Extract stock names and add to Set (automatically deduplicates)
				let batchUniqueCount = 0;
				rows.forEach(row => {
					// Handle different ZCQL result formats
					const stockName = row.Security_Name || 
					                 row[`${tableName}.Security_Name`] || 
					                 (row[tableName] && row[tableName].Security_Name);
					if (stockName && String(stockName).trim() !== '') {
						const trimmedStock = String(stockName).trim();
						const beforeSize = allStocks.size;
						allStocks.add(trimmedStock);
						if (allStocks.size > beforeSize) {
							batchUniqueCount++;
						}
					}
				});
				
				console.log(`[getStocksByClientId] Batch ${batchNumber}: Fetched ${rows.length} rows, ${batchUniqueCount} new unique stocks, total unique so far: ${allStocks.size}, total rows processed: ${totalRowsFetched}`);
				
				// If we got fewer rows than batchSize, we've reached the end
				if (rows.length < batchSize) {
					hasMore = false;
					console.log(`[getStocksByClientId] Batch ${batchNumber}: Reached end of data (got ${rows.length} < ${batchSize} rows)`);
				} else {
					offset += batchSize;
					// Safety limit
					if (offset > 1000000) {
						console.warn(`[getStocksByClientId] Reached safety limit of 1M rows, stopping`);
						hasMore = false;
					}
				}
			} catch (batchErr) {
				console.error(`[getStocksByClientId] Batch ${batchNumber} error at offset ${offset}:`, batchErr.message);
				
				// If OFFSET fails on first batch, try without OFFSET
				if (offset === 0) {
					console.log(`[getStocksByClientId] First batch with OFFSET failed, trying without OFFSET...`);
					try {
						const simpleQuery = `select Security_Name from ${tableName} where ${tableName}.WS_client_id = ${numClientId} and Security_Name is not null limit ${batchSize}`;
						const simpleRows = await zcql.executeZCQLQuery(simpleQuery, []);
						
						if (simpleRows && simpleRows.length > 0) {
							totalRowsFetched += simpleRows.length;
							let batchUniqueCount = 0;
							simpleRows.forEach(row => {
								const stockName = row.Security_Name || 
								                 row[`${tableName}.Security_Name`] || 
								                 (row[tableName] && row[tableName].Security_Name);
								if (stockName && String(stockName).trim() !== '') {
									const trimmedStock = String(stockName).trim();
									const beforeSize = allStocks.size;
									allStocks.add(trimmedStock);
									if (allStocks.size > beforeSize) {
										batchUniqueCount++;
									}
								}
							});
							console.log(`[getStocksByClientId] Simple query (no OFFSET) returned ${simpleRows.length} rows, ${batchUniqueCount} new unique stocks, total unique: ${allStocks.size}`);
						}
					} catch (simpleErr) {
						console.error(`[getStocksByClientId] Simple query also failed:`, simpleErr.message);
					}
				}
				hasMore = false;
			}
		}
		
		// Convert Set to sorted array
		const uniqueStocks = Array.from(allStocks).sort();
		
		console.log(`[getStocksByClientId] ===== FINAL RESULT =====`);
		console.log(`[getStocksByClientId] Total batches processed: ${batchNumber}`);
		console.log(`[getStocksByClientId] Total rows fetched: ${totalRowsFetched}`);
		console.log(`[getStocksByClientId] Total unique stocks for client ${numClientId}: ${uniqueStocks.length}`);
		console.log(`[getStocksByClientId] First 5 stocks:`, uniqueStocks.slice(0, 5));
		console.log(`[getStocksByClientId] ========================`);
		
		return res.status(200).json(uniqueStocks);
	} catch (err) {
		console.error('[getStocksByClientId] Fatal error:', err);
		console.error('[getStocksByClientId] Error details:', err.message);
		console.error('[getStocksByClientId] Error stack:', err.stack);
		return res.status(500).json({ 
			message: 'Failed to fetch stocks for client', 
			error: String(err && err.message ? err.message : err),
			details: err.toString()
		});
	}
};

// Get holdings summary for a client (stock-wise holdings with calculations)
exports.getHoldingsSummary = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}

		const clientId = req.query.clientId || req.query.ws_client_id;
		if (!clientId) {
			return res.status(400).json({ message: 'Client ID is required' });
		}

		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();

		// Validate client ID is numeric (for direct value insertion)
		const clientIdValue = String(clientId).trim();
		if (!/^\d+$/.test(clientIdValue)) {
			return res.status(400).json({ message: 'Invalid client ID format' });
		}
		const numClientId = parseInt(clientIdValue, 10);

		// Build WHERE clause with filters (Database level filtering - EFFICIENT)
		let whereClause = `WHERE ${tableName}.WS_client_id = ${numClientId}`;
		
		// Add date filter if provided (filters at database level)
		if (req.query.endDate || req.query.trandate_to) {
			const endDate = String(req.query.endDate || req.query.trandate_to).trim();
			if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
				whereClause += ` AND TRANDATE <= '${endDate}'`;
			}
		}

		console.log(`[getHoldingsSummary] Fetching transactions for client ${numClientId}...`);
		console.log(`[getHoldingsSummary] WHERE clause: ${whereClause}`);

		// Strategy: Fetch ALL transactions without OFFSET (ZCQL OFFSET can be unreliable)
		// Use a simpler approach: fetch in batches without OFFSET, using different ORDER BY
		const allTransactions = [];
		const batchSize = 250; // ZCQL max is 300, use 250 to be safe
		let totalFetched = 0;
		let lastStockName = '';
		let lastTrandate = '';
		let batchNumber = 0;
		let hasMore = true;

		// First, try to get distinct stock names to verify we're getting all stocks
		try {
			const distinctQuery = `SELECT DISTINCT Security_Name FROM ${tableName} ${whereClause}`;
			console.log(`[getHoldingsSummary] Checking distinct stocks with query: ${distinctQuery}`);
			const distinctRows = await zcql.executeZCQLQuery(distinctQuery, []);
			const distinctStocks = (distinctRows || []).map(r => {
				const r2 = r.Transaction || r[tableName] || r;
				return r2.Security_Name || r.Security_Name;
			}).filter(Boolean);
			console.log(`[getHoldingsSummary] Found ${distinctStocks.length} distinct stocks in database`);
			console.log(`[getHoldingsSummary] Sample distinct stocks:`, distinctStocks.slice(0, 10));
		} catch (distinctErr) {
			console.warn(`[getHoldingsSummary] Could not fetch distinct stocks:`, distinctErr.message);
		}

		// Fetch all transactions using cursor-based pagination (more reliable than OFFSET)
		while (hasMore) {
			batchNumber++;
			
			// Build query - try without OFFSET first, then use cursor-based approach
			let query;
			if (batchNumber === 1) {
				// First batch: simple query
				query = `SELECT Security_Name, Security_code, Tran_Type, QTY, Net_Amount, RATE 
						 FROM ${tableName} 
						 ${whereClause} 
						 ORDER BY Security_Name, TRANDATE 
						 LIMIT ${batchSize}`;
			} else {
				// Subsequent batches: use cursor (last stock name and date)
				// Note: ZCQL might not support this, so we'll use a simpler approach
				query = `SELECT Security_Name, Security_code, Tran_Type, QTY, Net_Amount, RATE 
						 FROM ${tableName} 
						 ${whereClause} 
						 ORDER BY Security_Name, TRANDATE 
						 LIMIT ${batchSize} OFFSET ${(batchNumber - 1) * batchSize}`;
			}

			try {
				console.log(`[getHoldingsSummary] Batch ${batchNumber}: Fetching...`);
				const rows = await zcql.executeZCQLQuery(query, []);

				if (!rows || rows.length === 0) {
					console.log(`[getHoldingsSummary] Batch ${batchNumber}: No more rows`);
					hasMore = false;
					break;
				}

				console.log(`[getHoldingsSummary] Batch ${batchNumber}: Fetched ${rows.length} rows`);
				allTransactions.push(...rows);
				totalFetched += rows.length;

				// Store last values for cursor (if needed)
				if (rows.length > 0) {
					const lastRow = rows[rows.length - 1];
					const r = lastRow.Transaction || lastRow[tableName] || lastRow;
					lastStockName = r.Security_Name || lastRow.Security_Name || '';
					lastTrandate = r.TRANDATE || lastRow.TRANDATE || '';
				}

				if (rows.length < batchSize) {
					console.log(`[getHoldingsSummary] Batch ${batchNumber}: Reached end (got ${rows.length} < ${batchSize})`);
					hasMore = false;
				} else {
					// Continue to next batch
					// Safety limit
					if (batchNumber > 2000) { // 2000 batches * 250 = 500K rows max
						console.warn(`[getHoldingsSummary] Reached safety limit of 2000 batches, stopping`);
						hasMore = false;
					}
				}
			} catch (queryErr) {
				console.error(`[getHoldingsSummary] Batch ${batchNumber} error:`, queryErr);
				console.error(`[getHoldingsSummary] Query that failed: ${query}`);
				// If OFFSET fails, try alternative approach
				if (batchNumber > 1 && queryErr.message && queryErr.message.includes('OFFSET')) {
					console.log(`[getHoldingsSummary] OFFSET not supported, trying alternative approach...`);
					hasMore = false;
				} else {
					throw queryErr;
				}
			}
		}

		console.log(`[getHoldingsSummary] ===== DATA FETCHING SUMMARY =====`);
		console.log(`[getHoldingsSummary] Total transactions fetched: ${totalFetched}`);
		console.log(`[getHoldingsSummary] Total batches processed: ${batchNumber}`);
		console.log(`[getHoldingsSummary] Client ID: ${numClientId}`);
		if (req.query.endDate || req.query.trandate_to) {
			console.log(`[getHoldingsSummary] Date filter: <= ${req.query.endDate || req.query.trandate_to}`);
		}
		
		// Log sample of raw transactions to debug
		if (allTransactions.length > 0) {
			console.log(`[getHoldingsSummary] Sample raw transactions (first 5):`, allTransactions.slice(0, 5).map(t => {
				const r = t.Transaction || t[tableName] || t;
				return {
					stockName: r.Security_Name || r[`${tableName}.Security_Name`],
					tranType: r.Tran_Type || r[`${tableName}.Tran_Type`],
					qty: r.QTY || r[`${tableName}.QTY`],
					netAmount: r.Net_Amount || r[`${tableName}.Net_Amount`]
				};
			}));
		}

		// Process transactions in JavaScript to calculate holdings (because ZCQL doesn't support CASE WHEN)
		const holdingsMap = new Map();

		// List of invalid entries that should be filtered out
		const invalidStockNames = [
			'CASH',
			'Tax Deducted at Source',
			'TAX',
			'TDS',
			'TAX DEDUCTED AT SOURCE'
		];

		let processedCount = 0;
		let skippedCount = 0;
		
		allTransactions.forEach((row, idx) => {
			// Handle different ZCQL result formats (including Transaction wrapper)
			const r = row.Transaction || row[tableName] || row;
			const stockName = r.Security_Name || 
							r[`${tableName}.Security_Name`] || 
							row.Security_Name ||
							row[`${tableName}.Security_Name`];
			const stockCode = r.Security_code || 
							r[`${tableName}.Security_code`] || 
							row.Security_code ||
							row[`${tableName}.Security_code`];
			const tranType = r.Tran_Type || 
							r[`${tableName}.Tran_Type`] || 
							row.Tran_Type ||
							row[`${tableName}.Tran_Type`];
			const qty = Number(r.QTY || r[`${tableName}.QTY`] || row.QTY || row[`${tableName}.QTY`] || 0);
			const netAmount = Number(r.Net_Amount || r[`${tableName}.Net_Amount`] || row.Net_Amount || row[`${tableName}.Net_Amount`] || 0);

			if (!stockName) {
				skippedCount++;
				if (idx < 5) {
					console.log(`[getHoldingsSummary] Skipping row ${idx + 1}: No stock name`, {
						hasTransaction: !!row.Transaction,
						hasTableName: !!row[tableName],
						keys: Object.keys(row)
					});
				}
				return;
			}

			// Filter out invalid entries (CASH, TAX, etc.)
			const isInvalid = invalidStockNames.some(invalid => 
				stockName.toUpperCase().trim() === invalid.toUpperCase().trim() ||
				stockName.toUpperCase().includes(invalid.toUpperCase())
			);
			
			if (isInvalid) {
				console.log(`[getHoldingsSummary] Filtering out invalid entry: ${stockName}`);
				return;
			}

			const key = `${stockName}|${stockCode || ''}`;

			if (!holdingsMap.has(key)) {
				holdingsMap.set(key, {
					stockName,
					stockCode: stockCode || '',
					totalBuyQty: 0,
					totalSellQty: 0,
					totalBuyAmount: 0,
					totalSellAmount: 0
				});
			}

			const holding = holdingsMap.get(key);
			const isBuy = tranType && String(tranType).toUpperCase().startsWith('B');

			if (isBuy) {
				holding.totalBuyQty += qty;
				holding.totalBuyAmount += netAmount;
			} else {
				holding.totalSellQty += qty;
				holding.totalSellAmount += netAmount;
			}
			
			processedCount++;
		});
		
		console.log(`[getHoldingsSummary] Processing summary: processed=${processedCount}, skipped=${skippedCount}, unique stocks=${holdingsMap.size}`);

		// Convert to array and calculate final metrics
		const allHoldings = Array.from(holdingsMap.values())
			.map(holding => {
				const currentHolding = holding.totalBuyQty - holding.totalSellQty;
				const profit = holding.totalSellAmount - holding.totalBuyAmount;
				const avgBuyPrice = holding.totalBuyQty > 0 ? holding.totalBuyAmount / holding.totalBuyQty : 0;
				const avgSellPrice = holding.totalSellQty > 0 ? holding.totalSellAmount / holding.totalSellQty : 0;

				return {
					stockName: holding.stockName,
					stockCode: holding.stockCode,
					currentHolding,
					totalBuyQty: holding.totalBuyQty,
					totalSellQty: holding.totalSellQty,
					totalBuyAmount: holding.totalBuyAmount,
					totalSellAmount: holding.totalSellAmount,
					profit,
					avgBuyPrice,
					avgSellPrice
				};
			});

		// Log all holdings before filtering
		console.log(`[getHoldingsSummary] ===== BEFORE FILTERING =====`);
		console.log(`[getHoldingsSummary] Total unique stocks processed: ${allHoldings.length}`);
		console.log(`[getHoldingsSummary] Sample holdings:`, allHoldings.slice(0, 10).map(h => ({
			stockName: h.stockName,
			currentHolding: h.currentHolding,
			totalBuyQty: h.totalBuyQty,
			totalSellQty: h.totalSellQty
		})));

		// Filter holdings - Show ALL stocks that have been traded (even if fully sold)
		const holdings = allHoldings
			.filter(holding => {
				// Filter out invalid entries only (CASH, TAX, etc.)
				const stockName = holding.stockName || '';
				const invalidStockNames = ['CASH', 'Tax Deducted at Source', 'TAX', 'TDS'];
				const isInvalid = invalidStockNames.some(name => 
					stockName.toUpperCase().includes(name.toUpperCase())
				);
				
				if (isInvalid) {
					console.log(`[getHoldingsSummary] Filtering out invalid: ${stockName}`);
					return false;
				}

				// Show ALL stocks that have trading activity (buy or sell)
				// Don't filter by currentHolding - show even if fully sold
				if (holding.totalBuyQty === 0 && holding.totalSellQty === 0) {
					console.log(`[getHoldingsSummary] Filtering out stock with no trading activity: ${stockName}`);
					return false;
				}
				
				return true;
			})
			.sort((a, b) => a.stockName.localeCompare(b.stockName));

		console.log(`[getHoldingsSummary] ===== AFTER FILTERING =====`);
		console.log(`[getHoldingsSummary] Total holdings (all traded stocks): ${holdings.length}`);
		console.log(`[getHoldingsSummary] Filtered out (invalid only): ${allHoldings.length - holdings.length} stocks`);
		
		// Log breakdown by holding status
		const withHoldings = holdings.filter(h => h.currentHolding > 0).length;
		const fullySold = holdings.filter(h => h.currentHolding <= 0).length;
		console.log(`[getHoldingsSummary] Breakdown: ${withHoldings} with remaining holdings, ${fullySold} fully sold`);
		
		console.log(`[getHoldingsSummary] Final holdings list:`, holdings.map(h => ({
			stockName: h.stockName,
			currentHolding: h.currentHolding,
			totalBuyQty: h.totalBuyQty,
			totalSellQty: h.totalSellQty
		})));

		return res.status(200).json(holdings);

	} catch (err) {
		console.error('[getHoldingsSummary] Error:', err);
		return res.status(500).json({ 
			message: 'Failed to fetch holdings summary', 
			error: String(err && err.message ? err.message : err)
		});
	}
};

// Get transaction history for a specific stock of a client
exports.getStockTransactionHistory = async (req, res) => {
	try {
		const app = req.catalystApp;
		if (!app) {
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}

		const clientId = req.query.clientId || req.query.ws_client_id;
		const stockName = decodeURIComponent(req.params.stockName); // URL parameter

		if (!clientId || !stockName) {
			return res.status(400).json({ message: 'Client ID and Stock Name are required' });
		}

		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();

		// Validate client ID
		const clientIdValue = String(clientId).trim();
		if (!/^\d+$/.test(clientIdValue)) {
			return res.status(400).json({ message: 'Invalid client ID format' });
		}
		const numClientId = parseInt(clientIdValue, 10);

		// Escape single quotes in stock name (ZCQL v2 requirement)
		const escapedStockName = String(stockName).trim().replace(/'/g, "''");

		// Build WHERE clause
		let whereClause = `WHERE ${tableName}.WS_client_id = ${numClientId} AND Security_Name = '${escapedStockName}'`;

		// Add date filter if provided
		if (req.query.endDate || req.query.trandate_to) {
			const endDate = String(req.query.endDate || req.query.trandate_to).trim();
			if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
				whereClause += ` AND TRANDATE <= '${endDate}'`;
			}
		}

		console.log(`[getStockTransactionHistory] Fetching transactions for client ${numClientId}, stock: ${stockName}`);

		// Fetch all transactions for this stock (with pagination if needed)
		const allTransactions = [];
		const batchSize = 250;
		let offset = 0;
		let hasMore = true;
		let totalFetched = 0;

		console.log(`[getStockTransactionHistory] Starting to fetch transactions for stock: ${stockName}`);

		while (hasMore) {
			const query = `SELECT * FROM ${tableName} ${whereClause} ORDER BY TRANDATE DESC LIMIT ${batchSize} OFFSET ${offset}`;

			try {
				console.log(`[getStockTransactionHistory] Fetching batch: offset=${offset}, limit=${batchSize}`);
				const rows = await zcql.executeZCQLQuery(query, []);

				if (!rows || rows.length === 0) {
					console.log(`[getStockTransactionHistory] No more rows at offset ${offset}`);
					hasMore = false;
					break;
				}

				console.log(`[getStockTransactionHistory] Batch ${Math.floor(offset/batchSize) + 1}: Fetched ${rows.length} rows`);
				allTransactions.push(...rows);
				totalFetched += rows.length;

				// Log sample of transaction types to debug
				if (offset === 0 && rows.length > 0) {
					const sampleTypes = rows.slice(0, 5).map(r => {
						const r2 = r.Transaction || r[tableName] || r;
						return r2.Tran_Type || r2.tran_type || 'UNKNOWN';
					});
					console.log(`[getStockTransactionHistory] Sample transaction types:`, sampleTypes);
				}

				if (rows.length < batchSize) {
					console.log(`[getStockTransactionHistory] Reached end of data (got ${rows.length} < ${batchSize} rows)`);
					hasMore = false;
				} else {
					offset += batchSize;
					// Increased limit for transaction history
					if (offset > 50000) {
						console.warn(`[getStockTransactionHistory] Reached safety limit of 50K rows, stopping`);
						hasMore = false;
					}
				}
			} catch (queryErr) {
				console.error('[getStockTransactionHistory] Query error:', queryErr);
				console.error('[getStockTransactionHistory] Query that failed:', query);
				throw queryErr;
			}
		}

		console.log(`[getStockTransactionHistory] Total fetched: ${totalFetched} transactions`);

		// Transform rows to match frontend format (same as in api.js)
		const transactions = allTransactions.map((row, index) => {
			// Handle Transaction wrapper from ZCQL
			const r = row.Transaction || row[tableName] || row;
			
			// Extract transaction type with multiple fallbacks
			const tranType = r.Tran_Type || 
							r.tran_type || 
							row.Tran_Type || 
							row.tran_type ||
							(r[`${tableName}.Tran_Type`] || row[`${tableName}.Tran_Type`]);
			
			const transaction = {
				wsClientId: r.WS_client_id ?? r.ws_client_id ?? (row.WS_client_id || row.ws_client_id),
				wsAccountCode: r.WS_Account_code ?? r.ws_account_code ?? (row.WS_Account_code || row.ws_account_code),
				trandate: r.TRANDATE ?? r.trandate ?? (row.TRANDATE || row.trandate),
				tranType: tranType,
				securityName: r.Security_Name ?? r.security_name ?? (row.Security_Name || row.security_name),
				securityCode: r.Security_code ?? r.security_code ?? (row.Security_code || row.security_code),
				exchg: r.EXCHG ?? r.exchg ?? (row.EXCHG || row.exchg),
				qty: r.QTY ?? r.qty ?? (row.QTY || row.qty),
				rate: r.RATE ?? r.rate ?? (row.RATE || row.rate),
				netAmount: r.Net_Amount ?? r.net_amount ?? r.netAmount ?? (row.Net_Amount || row.net_amount || row.netAmount),
			};
			
			// Debug first few transactions
			if (index < 3) {
				console.log(`[getStockTransactionHistory] Transaction ${index + 1}:`, {
					tranType: transaction.tranType,
					securityName: transaction.securityName,
					qty: transaction.qty,
					rawRow: Object.keys(row),
					hasTransaction: !!row.Transaction,
					hasTableName: !!row[tableName]
				});
			}
			
			return transaction;
		});

		// Log summary of transaction types
		const buyCount = transactions.filter(t => t.tranType && String(t.tranType).toUpperCase().startsWith('B')).length;
		const sellCount = transactions.filter(t => t.tranType && String(t.tranType).toUpperCase().startsWith('S')).length;
		const unknownCount = transactions.length - buyCount - sellCount;
		console.log(`[getStockTransactionHistory] Transaction summary: Buy=${buyCount}, Sell=${sellCount}, Unknown=${unknownCount}, Total=${transactions.length}`);

		return res.status(200).json(transactions);

	} catch (err) {
		console.error('[getStockTransactionHistory] Error:', err);
		return res.status(500).json({ 
			message: 'Failed to fetch stock transaction history', 
			error: String(err && err.message ? err.message : err)
		});
	}
};


