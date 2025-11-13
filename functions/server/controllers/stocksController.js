'use strict';

const DEFAULT_TABLE = 'Transaction';

function sanitizeIdentifier(identifier) {
	return String(identifier).replace(/[^a-zA-Z0-9_]/g, '');
}

function buildWhereClause(filters, params) {
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
			conditions.push(`${column} = ?`);
			params.push(filters[key]);
		}
	});

	// Date range filters
	if (filters.trandate_from) {
		conditions.push(`TRANDATE >= ?`);
		params.push(filters.trandate_from);
	}
	if (filters.trandate_to) {
		conditions.push(`TRANDATE <= ?`);
		params.push(filters.trandate_to);
	}
	if (filters.setdate_from) {
		conditions.push(`SETDATE >= ?`);
		params.push(filters.setdate_from);
	}
	if (filters.setdate_to) {
		conditions.push(`SETDATE <= ?`);
		params.push(filters.setdate_to);
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
		const where = buildWhereClause(req.query, params);

		// Order by TRANDATE desc by default
		const orderBy = ' ORDER BY TRANDATE DESC';

		const query = `select * from ${tableName}${where}${orderBy} limit ${limit} offset ${offset}`;

		const zcql = app.zcql();
		const rows = await zcql.executeZCQLQuery(query, params);

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
		const where = buildWhereClause(req.query, params);

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

		// Daily volume (last 30 days)
		let dailyVolume = [];
		try {
			const dailyQ = `select TRANDATE as _id, count(ROWID) as count, sum(Net_Amount) as totalValue from ${tableName}${where} group by TRANDATE order by TRANDATE desc limit 30`;
			const dailyRows = await zcql.executeZCQLQuery(dailyQ, params);
			dailyVolume = (dailyRows || []).map(row => ({
				_id: row._id || row.TRANDATE || row[`${tableName}.TRANDATE`],
				count: Number(row.count || row[`${tableName}.count`] || 0),
				totalValue: Number(row.totalValue || row[`${tableName}.totalValue`] || 0)
			})).reverse(); // Reverse to show oldest first
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
		const data = rows.map(r => r.EXCHG).filter(Boolean);
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
			return res.status(500).json({ message: 'Catalyst app context missing' });
		}
		const tableName = sanitizeIdentifier(req.query.table || DEFAULT_TABLE);
		const zcql = app.zcql();
		const query = `select distinct WS_client_id from ${tableName} where WS_client_id is not null`;
		const rows = await zcql.executeZCQLQuery(query, []);
		const data = rows.map(r => r.WS_client_id).filter(Boolean);
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch client ids', error: String(err && err.message ? err.message : err) });
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
		const query = `select distinct Security_Name from ${tableName} where Security_Name is not null`;
		const rows = await zcql.executeZCQLQuery(query, []);
		const data = rows.map(r => r.Security_Name).filter(Boolean);
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ message: 'Failed to fetch symbols', error: String(err && err.message ? err.message : err) });
	}
};


