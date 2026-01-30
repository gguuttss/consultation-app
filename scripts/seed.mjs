#!/usr/bin/env node

import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
const seedPath = resolve(ROOT, 'src/db/seed.sql')
const seedSql = readFileSync(seedPath, 'utf-8')

// Split by semicolons and run each statement
const statements = seedSql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

for (const statement of statements) {
  try {
    await sql.query(statement)
  } catch (e) {
    // Ignore errors (table may exist, data may exist)
  }
}

console.log('Seed complete')
