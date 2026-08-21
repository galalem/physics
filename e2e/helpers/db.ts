import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL not set (source backend/.env)')

const sql = postgres(DATABASE_URL)

export interface UserRow {
  id: string
  email: string
  first_name: string
  last_name: string
  locale: string
  role: string
  email_verified: boolean
  locked_until: Date | null
  failed_login_count: number
  created_at: Date
}

export async function getUser(email: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, email, first_name, last_name, locale, role,
           email_verified, locked_until, failed_login_count, created_at
    FROM users WHERE email = ${email.toLowerCase()}
  `
  return rows[0] ?? null
}

// Deletes any user whose email matches the test patterns. Cascades to
// sessions, email_changes, password_reset_tokens, password_changes,
// attempts. Returns the deleted emails.
export async function cleanupTestUsers(): Promise<string[]> {
  const rows = await sql<{ email: string }[]>`
    DELETE FROM users
    WHERE email LIKE 'e2e-%@example.com'
       OR email LIKE 'mail-%@example.com'
       OR email LIKE 'repro-%@example.com'
       OR email LIKE 'smoke-%@example.com'
       OR email LIKE 'env-%@example.com'
       OR email LIKE 'step3-%@example.com'
    RETURNING email
  `
  return rows.map((r) => r.email)
}

// CLI: `tsx helpers/db.ts <user <email> | cleanup>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2]
  const run = async () => {
    if (cmd === 'user') {
      const email = process.argv[3]
      if (!email) {
        console.error('Usage: tsx helpers/db.ts user <email>')
        process.exit(2)
      }
      const user = await getUser(email)
      if (!user) return console.log('(no such user)')
      console.log(JSON.stringify(user, null, 2))
      return
    }
    if (cmd === 'cleanup') {
      const deleted = await cleanupTestUsers()
      console.log(`Deleted ${deleted.length} test user(s):`)
      for (const e of deleted) console.log(`  - ${e}`)
      return
    }
    console.error('Usage: tsx helpers/db.ts <user <email> | cleanup>')
    process.exit(2)
  }
  run()
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
    .finally(() => sql.end())
}
