const express = require('express');
const mysql = require('mysql2/promise');
const { BlobServiceClient } = require('@azure/storage-blob');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configure Memory Storage for incoming files via Multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Global variable to hold our database connection pool
let pool;

// 2. Initialize Database and Create Table Automatically
async function initializeDatabase() {
    try {
        // Create the connection pool to Azure MySQL
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            ssl: { rejectUnauthorized: false } // Crucial for Azure MySQL security
        });

        console.log("Connecting to Azure MySQL and checking tables...");

        // The SQL script to create the table if it is missing
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                image_url VARCHAR(512) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // Execute the query
        await pool.execute(createTableQuery);
        console.log("Database initialized successfully: 'items' table is ready.");

    } catch (err) {
        console.error("❌ Database initialization failed:", err.message);
        process.exit(1); // Stop the server if it can't connect to the database
    }
}

// Trigger the initialization function
initializeDatabase();


// 3. Main Upload API Endpoint
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        const title = req.body.title;
        const file = req.file;

        if (!title || !file) {
            return res.status(400).json({ error: "Missing title or image file." });
        }

        // --- A. UPLOAD FILE TO AZURE BLOB STORAGE ---
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient(process.env.CONTAINER_NAME || 'uploads');
        
        // Generate a unique file name to avoid collisions
        const uniqueFileName = `${Date.now()}-${path.basename(file.originalname)}`;
        const blockBlobClient = containerClient.getBlockBlobClient(uniqueFileName);
        
        // Upload the raw file buffer directly to Azure Storage
        await blockBlobClient.uploadData(file.buffer, {
            blobHTTPHeaders: { blobContentType: file.mimetype }
        });
        const imageUrl = blockBlobClient.url; // This is your public cloud link

        // --- B. SAVE DATA TO MYSQL ---
        const query = 'INSERT INTO items (title, image_url) VALUES (?, ?)';
        await pool.execute(query, [title, imageUrl]);

        res.status(200).json({ 
            message: "Successfully saved to Azure MySQL & Blob Storage!",
            title: title,
            url: imageUrl 
        });

    } catch (error) {
        console.error("Upload error details:", error);
        res.status(500).json({ error: "Server error occurred during processing." });
    }
});

// Health check endpoint for Azure App Service routing
app.get('/', (req, res) => res.send('Backend API is running flawlessly!'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));