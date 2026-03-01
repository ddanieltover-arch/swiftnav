const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// In production (Render), DATABASE_URL is provided safely.
// For local development, this needs to be set in .env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('✅ Connected to PostgreSQL database.');

        // Create Users Table
        await client.query(`CREATE TABLE IF NOT EXISTS Users (
            id SERIAL PRIMARY KEY,
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            is_auto INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            reset_code TEXT,
            reset_expires TIMESTAMPTZ
        )`);

        // Seed Admin User
        const adminCheck = await client.query('SELECT * FROM Users WHERE email = $1', ['admin@swiftnav.com']);
        if (adminCheck.rows.length === 0) {
            const hash = await bcrypt.hash('password123', 10);
            await client.query('INSERT INTO Users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
                ['System Admin', 'admin@swiftnav.com', hash, 'admin']);
            console.log('✅ Admin user seeded (admin@swiftnav.com / password123)');
        }

        // Create Shipments Table
        await client.query(`CREATE TABLE IF NOT EXISTS Shipments (
            tracking_number TEXT PRIMARY KEY,
            user_id INTEGER REFERENCES Users(id),
            shipment_type TEXT,
            carrier TEXT,
            sender_name TEXT,
            sender_phone TEXT,
            sender_email TEXT,
            sender_address TEXT,
            receiver_name TEXT,
            receiver_phone TEXT,
            receiver_email TEXT,
            receiver_address TEXT,
            weight REAL,
            dimensions TEXT,
            current_lat REAL,
            current_lng REAL,
            status TEXT,
            current_date_time TEXT,
            departure_date_time TEXT,
            delivery_date_time TEXT,
            description TEXT,
            origin TEXT,
            destination TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0
        )`);

        // Create TrackingEvents Table
        await client.query(`CREATE TABLE IF NOT EXISTS TrackingEvents (
            id SERIAL PRIMARY KEY,
            tracking_number TEXT REFERENCES Shipments(tracking_number) ON DELETE CASCADE,
            status_marker TEXT,
            location TEXT,
            description TEXT,
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

    } catch (err) {
        console.error('❌ Database Initialization Error:', err.message);
    } finally {
        client.release();
    }
};

// Utility to convert SQLite '?' to Postgres '$1, $2, ...'
const sqliteToPg = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
};

const db = {
    query: (text, params) => pool.query(sqliteToPg(text), params),

    // SQLite compatibility wrappers
    get: (text, params, callback) => {
        pool.query(sqliteToPg(text), params)
            .then(res => {
                if (callback) callback(null, res.rows[0]);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    all: (text, params, callback) => {
        pool.query(sqliteToPg(text), params)
            .then(res => {
                if (callback) callback(null, res.rows);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    run: function (text, params, callback) {
        // Handle optional params
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        pool.query(sqliteToPg(text), params)
            .then(res => {
                // SQLite's this.lastID and this.changes workaround
                const result = {
                    lastID: res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null,
                    changes: res.rowCount
                };
                if (callback) callback.call(result, null);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    serialize: (fn) => fn()
};

// Auto-init for now, or export init function
initializeDatabase();

module.exports = db;
