#!/usr/bin/env node

import { execSync } from 'child_process'
import { createInterface } from 'readline'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

const PLATFORMS = {
  vercel: {
    name: 'Vercel',
    plugin: null, // Vercel auto-detects TanStack Start
    import: null,
    pluginCall: null,
    deployCmd: 'pnpm dlx vercel --prod',
    setEnvCmd: 'pnpm dlx vercel env add DATABASE_URL production',
    setEnvViaStdin: true,
  },
  cloudflare: {
    name: 'Cloudflare Workers',
    plugin: null, // Uses Nitro config instead
    import: null,
    pluginCall: null,
    nitroConfig: `{
      preset: 'cloudflare-module',
      cloudflare: {
        wrangler: {
          compatibility_flags: ['nodejs_compat_populate_process_env'],
        },
      },
    }`,
    needsBuild: true,
    deployCmd: 'pnpm dlx wrangler deploy',
    // setEnvCmd is dynamically generated after build (needs worker name from wrangler.json)
    setEnvCmd: null,
    setEnvViaStdin: true,
  },
  netlify: {
    name: 'Netlify',
    plugin: '@netlify/vite-plugin-tanstack-start',
    import: "import netlify from '@netlify/vite-plugin-tanstack-start'",
    pluginCall: 'netlify()',
    extraFiles: {
      'netlify.toml': `[build]
  command = "pnpm run build"
  publish = "dist"
`,
    },
    deployCmd: 'pnpm --package=netlify-cli dlx netlify deploy --build --prod',
    // Special handling - use env:import from .env file
    setEnvCmd: 'netlify-env-import',
    setEnvViaStdin: false,
  },
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (q) => new Promise((res) => rl.question(q, res))

const log = (msg) => console.log(`\n\x1b[36m> ${msg}\x1b[0m`)
const success = (msg) => console.log(`\x1b[32m  OK\x1b[0m ${msg}`)
const warn = (msg) => console.log(`\x1b[33m  !\x1b[0m ${msg}`)
const error = (msg) => console.log(`\x1b[31m  X\x1b[0m ${msg}`)

function getDbUrl() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return null
  const content = readFileSync(envPath, 'utf-8')
  const match = content.match(/DATABASE_URL=(.+)/)
  return match ? match[1].trim() : null
}

function getClaimUrl() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return null
  const content = readFileSync(envPath, 'utf-8')
  const match = content.match(/PUBLIC_INSTAGRES_CLAIM_URL=(.+)/)
  return match ? match[1].trim() : null
}

async function main() {
  console.log('\n\x1b[1mTanStack Start Deploy\x1b[0m')
  console.log('\x1b[90mOne command to deploy your app + database\x1b[0m\n')

  // Step 1: Platform selection
  log('Select Deployment Platform')
  console.log('')
  console.log('  1. Vercel')
  console.log('  2. Cloudflare Workers')
  console.log('  3. Netlify')
  console.log('')

  const platformChoice = await question('  Enter number (1-3): ')
  const platformKey = ['vercel', 'cloudflare', 'netlify'][parseInt(platformChoice) - 1]

  if (!platformKey) {
    error('Invalid selection')
    rl.close()
    process.exit(1)
  }

  const platform = PLATFORMS[platformKey]
  success(`Selected: ${platform.name}`)

  // Step 2: Database provisioning
  log('Database Setup')

  let dbUrl = getDbUrl()
  let claimUrl = getClaimUrl()

  if (dbUrl) {
    success('Found existing DATABASE_URL in .env')
  } else {
    console.log('  Provisioning a new Neon Postgres database...')
    console.log('')

    try {
      // Run get-db and capture all output
      execSync('pnpm dlx get-db -y', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      })

      dbUrl = getDbUrl()
      claimUrl = getClaimUrl()

      if (dbUrl) {
        success('Database provisioned!')
      } else {
        error('Failed to provision database')
        rl.close()
        process.exit(1)
      }
    } catch (e) {
      // get-db may exit with error but still succeed - check .env
      dbUrl = getDbUrl()
      claimUrl = getClaimUrl()

      if (!dbUrl) {
        error('Failed to provision database. Run `pnpm dlx get-db` manually to debug.')
        rl.close()
        process.exit(1)
      }
      success('Database provisioned!')
    }
  }

  // Step 3: Push schema and seed
  log('Database Schema')
  console.log('  Pushing schema to database...')

  try {
    execSync('pnpm db:push', { cwd: ROOT, stdio: 'inherit' })
    success('Schema pushed!')
  } catch (e) {
    warn('Schema push had issues (may be okay if tables exist)')
  }

  // Run seed SQL
  log('Seeding Database')
  console.log('  Running seed.sql...')

  try {
    execSync('node scripts/seed.mjs', {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: dbUrl },
    })
    success('Database seeded!')
  } catch (e) {
    warn('Seeding had issues (may be okay if data exists)')
  }

  // Step 4: Install platform plugin (if needed)
  if (platform.plugin) {
    log(`Installing ${platform.name} Plugin`)

    try {
      execSync(`pnpm add -D ${platform.plugin}`, { stdio: 'inherit', cwd: ROOT })
      success('Plugin installed')
    } catch (e) {
      error('Failed to install plugin')
      rl.close()
      process.exit(1)
    }

    // Step 6: Update vite.config.ts
    log('Configuring Vite')

    const viteConfigPath = resolve(ROOT, 'vite.config.ts')
    let viteConfig = readFileSync(viteConfigPath, 'utf-8')

    if (!viteConfig.includes(platform.import)) {
      viteConfig = viteConfig.replace(
        "import { defineConfig } from 'vite'",
        `import { defineConfig } from 'vite'\n${platform.import}`,
      )
    }

    if (!viteConfig.includes(platform.pluginCall)) {
      viteConfig = viteConfig.replace('plugins: [', `plugins: [\n    ${platform.pluginCall},`)
    }

    writeFileSync(viteConfigPath, viteConfig)
    success('vite.config.ts updated')
  } else if (platform.nitroConfig) {
    // Configure Nitro with full config (for Cloudflare with compatibility flags, etc.)
    log('Configuring Nitro')

    const viteConfigPath = resolve(ROOT, 'vite.config.ts')
    let viteConfig = readFileSync(viteConfigPath, 'utf-8')

    // Replace nitro() or nitro({...}) with the full config
    if (viteConfig.includes('nitro()')) {
      viteConfig = viteConfig.replace('nitro()', `nitro(${platform.nitroConfig})`)
      writeFileSync(viteConfigPath, viteConfig)
      success('Configured Nitro for Cloudflare')
    } else if (viteConfig.match(/nitro\(\{[\s\S]*?\}\)/)) {
      // Already has config, replace it
      viteConfig = viteConfig.replace(/nitro\(\{[\s\S]*?\}\)/, `nitro(${platform.nitroConfig})`)
      writeFileSync(viteConfigPath, viteConfig)
      success('Configured Nitro for Cloudflare')
    } else {
      warn('Could not find nitro() in vite.config.ts - you may need to configure it manually')
    }
  } else if (platform.nitroPreset) {
    // Configure Nitro preset only
    log('Configuring Nitro Preset')

    const viteConfigPath = resolve(ROOT, 'vite.config.ts')
    let viteConfig = readFileSync(viteConfigPath, 'utf-8')

    if (viteConfig.includes('nitro()')) {
      viteConfig = viteConfig.replace('nitro()', `nitro({ preset: '${platform.nitroPreset}' })`)
      writeFileSync(viteConfigPath, viteConfig)
      success(`Configured Nitro with preset: ${platform.nitroPreset}`)
    } else if (viteConfig.includes('nitro({')) {
      viteConfig = viteConfig.replace('nitro({', `nitro({ preset: '${platform.nitroPreset}',`)
      writeFileSync(viteConfigPath, viteConfig)
      success(`Configured Nitro with preset: ${platform.nitroPreset}`)
    } else {
      warn('Could not find nitro() in vite.config.ts - you may need to add the preset manually')
    }
  } else {
    success(`${platform.name} auto-detects TanStack Start - no plugin needed`)
  }

  // Create extra files if needed
  if (platform.extraFiles) {
    for (const [filename, content] of Object.entries(platform.extraFiles)) {
      const filePath = resolve(ROOT, filename)
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content)
        success(`Created ${filename}`)
      }
    }
  }

  // Build if needed (Cloudflare, Netlify need pre-built output)
  if (platform.needsBuild) {
    log('Building Application')
    try {
      execSync('pnpm build', { stdio: 'inherit', cwd: ROOT })
      success('Build complete!')

      // For Cloudflare, read worker name from generated wrangler.json and set up env command
      if (platformKey === 'cloudflare') {
        const wranglerJsonPath = resolve(ROOT, '.output/server/wrangler.json')
        if (existsSync(wranglerJsonPath)) {
          const wranglerConfig = JSON.parse(readFileSync(wranglerJsonPath, 'utf-8'))
          const workerName = wranglerConfig.name
          if (workerName) {
            platform.setEnvCmd = `pnpm dlx wrangler secret put DATABASE_URL --name ${workerName}`
            success(`Worker name: ${workerName}`)
          }
        }
      }
    } catch (e) {
      error('Build failed')
      rl.close()
      process.exit(1)
    }
  }

  // Step 7: Deploy
  log(`Deploying to ${platform.name}`)
  console.log('  This will open the platform CLI (you may need to log in)')
  console.log('')

  // For Netlify, we need to create the site first (non-interactive)
  let netlifySiteName = null
  if (platformKey === 'netlify') {
    const defaultName = 'tanstack-start-' + Math.random().toString(36).substring(2, 8)
    netlifySiteName = await question(`  Site name (default: ${defaultName}): `)
    if (!netlifySiteName.trim()) {
      netlifySiteName = defaultName
    }
    console.log('')
  }

  const proceed = await question('  Ready to deploy? (y/n): ')
  if (proceed.toLowerCase() !== 'y') {
    console.log('\n  To deploy later, run:')
    console.log(`  \x1b[1m${platform.deployCmd}\x1b[0m\n`)
    printFinalInstructions(platform, dbUrl, claimUrl, false)
    rl.close()
    return
  }

  rl.close()

  // Run deploy
  try {
    if (platformKey === 'netlify' && netlifySiteName) {
      // Create and link site first, then deploy
      console.log(`\n  Creating site: ${netlifySiteName}...`)
      try {
        execSync(`pnpm --package=netlify-cli dlx netlify sites:create --name ${netlifySiteName}`, {
          stdio: 'inherit',
          cwd: ROOT,
        })
      } catch (e) {
        // Site might already exist, continue anyway
      }
      execSync(`pnpm --package=netlify-cli dlx netlify link --name ${netlifySiteName}`, {
        stdio: 'inherit',
        cwd: ROOT,
      })
      execSync('pnpm --package=netlify-cli dlx netlify deploy --build --prod', {
        stdio: 'inherit',
        cwd: ROOT,
      })
    } else {
      execSync(platform.deployCmd, { stdio: 'inherit', cwd: ROOT })
    }
  } catch (e) {
    // Deploy commands often exit with non-zero on first run (need login, etc.)
  }

  // Auto-set DATABASE_URL env var
  if (platform.setEnvCmd) {
    console.log('\n')
    log('Setting DATABASE_URL environment variable')
    try {
      if (platform.setEnvCmd === 'netlify-env-import') {
        // Netlify: create temp env file with just DATABASE_URL and import it
        const tempEnvPath = resolve(ROOT, '.env.deploy')
        writeFileSync(tempEnvPath, `DATABASE_URL=${dbUrl}\n`)
        execSync('pnpm --package=netlify-cli dlx netlify env:import .env.deploy', {
          stdio: 'inherit',
          cwd: ROOT,
        })
        // Clean up temp file
        try {
          unlinkSync(tempEnvPath)
        } catch (e) {
          // Ignore cleanup errors
        }
      } else if (platform.setEnvViaStdin) {
        // Pass value via stdin to avoid shell escaping issues
        execSync(platform.setEnvCmd, {
          stdio: ['pipe', 'inherit', 'inherit'],
          cwd: ROOT,
          input: dbUrl,
        })
      } else {
        // Pass value as command argument
        const cmd = typeof platform.setEnvCmd === 'function' ? platform.setEnvCmd(dbUrl) : platform.setEnvCmd
        execSync(cmd, { stdio: 'inherit', cwd: ROOT })
      }
      success('DATABASE_URL set!')

      // Trigger redeploy so the env var takes effect
      log('Redeploying with DATABASE_URL...')
      try {
        if (platformKey === 'netlify') {
          execSync('pnpm --package=netlify-cli dlx netlify deploy --build --prod', {
            stdio: 'inherit',
            cwd: ROOT,
          })
        } else {
          execSync(platform.deployCmd, { stdio: 'inherit', cwd: ROOT })
        }
      } catch (e) {
        // Ignore errors
      }
    } catch (e) {
      warn('Could not auto-set DATABASE_URL. You may need to set it manually.')
    }
  }

  printFinalInstructions(platform, dbUrl, claimUrl, true)
}

function printFinalInstructions(platform, dbUrl, claimUrl, deployed) {
  console.log('\n')
  console.log('\x1b[32m========================================\x1b[0m')

  if (deployed) {
    console.log('\x1b[32m  Deployed successfully!\x1b[0m')
  } else {
    console.log('\x1b[33m  Ready to deploy\x1b[0m')
  }

  console.log('\x1b[32m========================================\x1b[0m\n')

  // Claim instructions
  console.log('\x1b[1mIMPORTANT - Claim your database:\x1b[0m')
  console.log('Your database will \x1b[33mexpire in 72 hours\x1b[0m unless claimed!')
  if (claimUrl) {
    console.log(`\nClaim here: \x1b[36m${claimUrl}\x1b[0m`)
  } else {
    console.log('\nVisit \x1b[36mhttps://console.neon.tech\x1b[0m to claim it.')
  }
  console.log('')
}

main().catch((e) => {
  error(e.message)
  process.exit(1)
})
