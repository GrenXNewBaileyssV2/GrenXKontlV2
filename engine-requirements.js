import fs from 'node:fs'

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const range = packageJson.engines?.node
const match = typeof range === 'string' && range.match(/^>=\s*(\d+)(?:\.\d+\.\d+)?\s+<\s*(\d+)(?:\.\d+\.\d+)?$/)

if (!match) {
  console.error(`\nInvalid or unsupported engines.node range in package.json: ${String(range)}`)
  process.exit(1)
}

const minMajor = Number(match[1])
const maxMajorExclusive = Number(match[2])
const nodeMajor = Number(process.versions.node.split('.')[0])

if (nodeMajor < minMajor || nodeMajor >= maxMajorExclusive) {
  console.error(
    `\n❌ This package requires Node.js >=${minMajor} and <${maxMajorExclusive}.\n` +
    `   You are using Node.js ${process.versions.node}.\n` +
    `   Please use a supported Node.js release.\n`
  )
  process.exit(1)
}

