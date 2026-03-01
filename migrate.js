const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const newCols = [
    'shipment_type TEXT',
    'carrier TEXT',
    'sender_phone TEXT',
    'sender_email TEXT',
    'receiver_phone TEXT',
    'current_date_time TEXT',
    'departure_date_time TEXT',
    'delivery_date_time TEXT',
    'description TEXT'
];

db.serialize(() => {
    newCols.forEach(col => {
        db.run(`ALTER TABLE Shipments ADD COLUMN ${col};`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error("Migration err:", err.message);
            } else {
                console.log(`Added column ${col}`);
            }
        });
    });

    // Also update TrackingEvents for the current_date_time field
    db.run(`ALTER TABLE TrackingEvents ADD COLUMN current_date_time TEXT;`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error("Migration err on Events:", err.message);
        } else {
            console.log("Added current_date_time to TrackingEvents");
        }
    });
});

db.close(() => console.log('Migration complete.'));
