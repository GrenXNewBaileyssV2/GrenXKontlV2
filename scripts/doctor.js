#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const engineRange = pkg.engines?.node || ''
const engineMatch = engineRange.match(/^>=\s*(\d+)(?:\.\d+\.\d+)?\s+<\s*(\d+)(?:\.\d+\.\d+)?$/)
const requiredNode = engineMatch ? { min: Number(engineMatch[1]), maxExclusive: Number(engineMatch[2]) } : null
const nodeMajor = Number(process.versions.node.split('.')[0])
const failures = []
const warnings = []

const report = (ok, label, detail = '') => {
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log(`\n${pkg.name} ${pkg.version} · environment doctor\n`)
report(Boolean(requiredNode && nodeMajor >= requiredNode.min && nodeMajor < requiredNode.maxExclusive), 'Node.js version', `${process.versions.node} (package engines.node: ${engineRange || 'invalid'})`)

for (const [name, range] of Object.entries(pkg.dependencies || {})) {
  try {
    const packageJson = import.meta.resolve(`${name}/package.json`)
    report(true, `dependency ${name}`, range)
    void packageJson
  } catch {
    // Some packages intentionally hide package.json via exports; resolve the package entry instead.
    try {
      import.meta.resolve(name)
      report(true, `dependency ${name}`, range)
    } catch {
      report(false, `dependency ${name}`, `missing (${range}); run npm install`)
    }
  }
}

for (const [subpath, target] of Object.entries(pkg.exports || {})) {
  const entry = typeof target === 'string' ? target : target.import || target.default
  const typeEntry = typeof target === 'object' ? target.types : undefined
  report(Boolean(entry && fs.existsSync(path.join(root, entry))), `export ${subpath}`, entry || 'no runtime entry')
  if (typeEntry) report(fs.existsSync(path.join(root, typeEntry)), `types ${subpath}`, typeEntry)
}

const syntaxFiles = []
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && full.endsWith('.js')) syntaxFiles.push(full)
  }
}
walk(root)
let syntaxFailed = 0
for (const file of syntaxFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    syntaxFailed++
    console.error(result.stderr || result.stdout)
  }
}
report(syntaxFailed === 0, 'JavaScript syntax', `${syntaxFiles.length - syntaxFailed}/${syntaxFiles.length} files valid`)

if (failures.length) {
  console.log(`\nDoctor found ${failures.length} issue(s). Install missing dependencies and resolve the reported package issues before release.`)
  process.exitCode = 1
} else {
  console.log('\nEnvironment and package entry points look ready. Run npm test before release.')
}
