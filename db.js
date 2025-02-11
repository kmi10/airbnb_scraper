const { Pool } = require('pg');

// Configuración del cliente de PostgreSQL
const pool = new Pool({
    user: 'scraper_user',
    host: 'localhost',
    database: 'airbnb_scraper',
    password: 'scraper_password',
    port: 5432, // Puerto por defecto de PostgreSQL
});

module.exports = pool;
