const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const dbURL = process.env.DATABASE_URL;
// Explicitly force SQLite if we are on localhost or if the URL is missing/commented out
const isLocal = !dbURL || dbURL.includes('localhost') || !dbURL.startsWith('postgres');
const isProd = !isLocal && process.env.NODE_ENV === 'production';

// Log for debugging (this will help the user see what's being detected)
console.log('🔍 Database URL detected:', dbURL ? `Present (Starts with ${dbURL.substring(0, 8)}...)` : 'None');
console.log('🔍 isLocal:', isLocal, '| isProd:', isProd);

let db;

// Hybrid Database System: PostgreSQL for Production (Render), SQLite for Local
if (isProd) {
    console.log('🌐 Using PostgreSQL (Production Mode)');
    const pool = new Pool({
        connectionString: dbURL,
        ssl: { rejectUnauthorized: false }
    });

    const sqliteToPg = (query) => {
        let index = 1;
        let pgQuery = query.replace(/\?/g, () => `$${index++}`);
        const upperQuery = pgQuery.toUpperCase().trim();
        if (upperQuery.startsWith('INSERT INTO')) {
            if (!upperQuery.includes('RETURNING')) {
                if (upperQuery.includes('USERS')) pgQuery += ' RETURNING id';
                else if (upperQuery.includes('SHIPMENTS')) pgQuery += ' RETURNING tracking_number';
                else if (upperQuery.includes('TRACKINGEVENTS')) pgQuery += ' RETURNING id';
            }
        }
        return pgQuery;
    };

    const handlePoolError = (err) => {
        if (err.code === 'ENETUNREACH') {
            console.error('❌ PRODUCTION DB ERROR (ENETUNREACH): Render cannot reach Supabase via IPv6.');
            console.error('💡 FIX: Use the Supabase Connection Pooler string (Session Mode) with IPv4 in Render Settings.');
        } else {
            console.error('❌ DB ERROR:', err.message);
        }
        return err;
    };

    db = {
        query: (text, params) => {
            if (typeof params === 'function') params = [];
            return pool.query(sqliteToPg(text), params).catch(err => { throw handlePoolError(err); });
        },
        get: (text, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => callback(null, res.rows[0]))
                .catch(err => callback(handlePoolError(err)));
        },
        all: (text, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => callback(null, res.rows))
                .catch(err => callback(handlePoolError(err)));
        },
        run: function (text, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => {
                    const result = {
                        lastID: res.rows && res.rows[0] ? (res.rows[0].id || res.rows[0].tracking_number) : null,
                        changes: res.rowCount
                    };
                    if (callback) callback.call(result, null);
                })
                .catch(err => callback(handlePoolError(err)));
        }
    };
} else {
    console.log('🏠 Using SQLite (Local Development Mode)');
    const dbPath = path.join(__dirname, 'database.sqlite');
    const sqliteDb = new sqlite3.Database(dbPath);

    db = {
        query: (text, params) => new Promise((resolve, reject) => {
            sqliteDb.all(text, params, (err, rows) => err ? reject(err) : resolve({ rows }));
        }),
        get: (text, params, callback) => sqliteDb.get(text, params, callback),
        all: (text, params, callback) => sqliteDb.all(text, params, callback),
        run: function (text, params, callback) {
            sqliteDb.run(text, params, callback);
        }
    };
}

const initializeDatabase = async () => {
    try {
        const createUsers = `CREATE TABLE IF NOT EXISTS Users (
            id ${isProd ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            is_auto INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            reset_code TEXT,
            reset_expires TIMESTAMPTZ
        )`;

        const createShipments = `CREATE TABLE IF NOT EXISTS Shipments (
            tracking_number TEXT PRIMARY KEY,
            user_id INTEGER,
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
        )`;

        const createEvents = `CREATE TABLE IF NOT EXISTS TrackingEvents (
            id ${isProd ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            tracking_number TEXT,
            status_marker TEXT,
            location TEXT,
            description TEXT,
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`;

        // Run in series
        await db.query(createUsers);
        await db.query(createShipments);
        await db.query(createEvents);

        // Migrations
        try {
            await db.query(`ALTER TABLE Users ADD COLUMN role TEXT DEFAULT 'user'`);
            await db.query(`ALTER TABLE Users ADD COLUMN is_auto INTEGER DEFAULT 0`);
        } catch (e) { /* ignore */ }

        // Seed Admin (Awaited)
        await new Promise((resolve, reject) => {
            db.get('SELECT * FROM Users WHERE email = ?', ['admin@swiftnav.com'], async (err, user) => {
                if (err) return reject(err);
                if (!user) {
                    const hash = await bcrypt.hash('password123', 10);
                    db.run('INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
                        ['System Admin', 'admin@swiftnav.com', hash, 'admin'], (err) => {
                            if (err) reject(err);
                            else {
                                console.log('✅ Admin account seeded: admin@swiftnav.com / password123');
                                resolve();
                            }
                        });
                } else {
                    if (user.role !== 'admin') {
                        db.run('UPDATE Users SET role = ? WHERE email = ?', ['admin', 'admin@swiftnav.com'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    } else {
                        resolve();
                    }
                }
            });
        });

        console.log('✅ Database Schema Verified.');
    } catch (err) {
        console.error('❌ Database Init Error:', err.message);
    }
};

initializeDatabase();

module.exports = db;
