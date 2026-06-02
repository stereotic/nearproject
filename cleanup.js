const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'near.db');
const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(dbPath)) {
    console.error('Database file not found!');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Delete all items
    db.run('DELETE FROM items', (err) => {
        if (err) console.error('Error deleting items:', err.message);
        else console.log('Successfully deleted all items from near.db');
    });

    // Delete all purchases (since they reference items that no longer exist)
    db.run('DELETE FROM purchases', (err) => {
        if (err) console.error('Error deleting purchases:', err.message);
        else console.log('Successfully deleted all purchases from near.db');
    });

    // Optionally delete notifications and messages if the user wants a full reset, 
    // but the request was specifically about cards. I'll stick to items and purchases for now.
});

db.close((err) => {
    if (err) console.error(err.message);
    else {
        console.log('Database connection closed.');
        
        // Clear uploads folder
        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            for (const file of files) {
                fs.unlinkSync(path.join(uploadDir, file));
            }
            console.log('Successfully cleared uploads folder');
        }
    }
});
