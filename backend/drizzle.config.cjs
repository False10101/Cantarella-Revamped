const { readFileSync } = require('fs')
const { join } = require('path')
require('dotenv').config()

/** @type {import('drizzle-kit').Config} */
module.exports = {
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: {
      ca: readFileSync(join(__dirname, './isrgrootx1.pem')).toString()
    }
  },
  out: './db'
}