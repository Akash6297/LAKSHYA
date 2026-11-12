// Rasterizes public/favicon.svg into PWA / Apple icons. Run: npm run gen:icons
import sharp from 'sharp'
import { mkdirSync, readFileSync } from 'node:fs'

const svg = readFileSync('public/favicon.svg')
mkdirSync('public/icons', { recursive: true })

const plain = (size, file) => sharp(svg, { density: 512 }).resize(size, size).png().toFile(`public/icons/${file}`)

// Maskable icons need the artwork inside the central 80% "safe zone" on a full-bleed background.
async function maskable(size, file) {
  const inner = Math.round(size * 0.72)
  const mark = await sharp(svg, { density: 512 }).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: '#4F46E5' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`public/icons/${file}`)
}

await Promise.all([
  plain(192, 'icon-192.png'),
  plain(512, 'icon-512.png'),
  maskable(512, 'icon-maskable-512.png'),
  maskable(180, 'apple-touch-icon.png'),
])
console.log('Icons written to public/icons/')
