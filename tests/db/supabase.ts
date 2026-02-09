import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

type TestUser = {
  id: string
  email: string
  password: string
}

export function getSupabaseEnv() {
  loadTestEnv()
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceRoleKey) {
    return null
  }

  if (!isLocalSupabaseUrl(url)) {
    console.warn('[db tests] SUPABASE_URL is not local; skipping DB tests for safety.')
    return null
  }

  return { url, anonKey, serviceRoleKey }
}

let envLoaded = false

function loadTestEnv() {
  if (envLoaded) return
  envLoaded = true

  const root = process.cwd()
  loadEnvFile(path.join(root, '.env.test.local'))
  loadEnvFile(path.join(root, '.env.test'))
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    value = value.replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function isLocalSupabaseUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

export function createAdminClient(env: { url: string; serviceRoleKey: string }) {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAnonClient(env: { url: string; anonKey: string }) {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  metadata: { username: string; display_name: string; language_preference?: string }
): Promise<TestUser> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })

  if (error || !data.user) {
    throw error || new Error('Failed to create user')
  }

  return { id: data.user.id, email, password }
}

export async function signInUser(
  client: SupabaseClient,
  email: string,
  password: string
) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    throw error
  }
  return data.session
}
