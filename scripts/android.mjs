// Builds the personal Jarvis APK:  npm run android:build
//
//  1. downloads the free offline wake-word model (Vosk, Indian English, ~37 MB) once
//  2. creates a personal signing key once (outside the repo, in ~/.lakshya)
//  3. builds the web app in "android" mode (Jarvis on, links point at the live site)
//  4. copies it into the Android project and compiles a signed APK with Gradle
//  5. puts the APK in release/Lakshya-Jarvis.apk
//
// Needs JDK 21 + Android SDK (Android Studio, or the command-line tools). On
// Windows they are found in %LOCALAPPDATA%\Programs\jdk-21 and %LOCALAPPDATA%\Android\Sdk.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const MODEL = 'vosk-model-small-en-in-0.4'
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL}.zip`
// Cache outside the project: the model is large and Gradle output shouldn't sit in synced folders (OneDrive).
const cache = process.env.LAKSHYA_ANDROID_CACHE || (win ? join(process.env.LOCALAPPDATA, 'lakshya-android') : join(homedir(), '.cache', 'lakshya-android'))
const step = (m) => console.log(`\n▶ ${m}`)

function run(cmd, args, opts = {}) {
  // Windows needs a shell for npx/.bat files; pass one command line so nothing is concatenated unexpectedly
  const r = win
    ? spawnSync([cmd, ...args].join(' '), { stdio: 'inherit', cwd: root, shell: true, ...opts })
    : spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`)
}

function findTools() {
  const javaHome = process.env.JAVA_HOME || (win ? join(process.env.LOCALAPPDATA, 'Programs', 'jdk-21') : '')
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (win ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : join(homedir(), 'Android', 'Sdk'))
  if (!javaHome || !existsSync(join(javaHome, 'bin', win ? 'java.exe' : 'java'))) throw new Error('JDK 21 not found. Install it or set JAVA_HOME.')
  if (!existsSync(join(sdk, 'platforms'))) throw new Error('Android SDK not found. Install Android Studio or set ANDROID_HOME.')
  const props = join(root, 'android', 'local.properties')
  // .properties format: forward slashes, and the drive colon escaped (C\:/...)
  if (!existsSync(props)) writeFileSync(props, `sdk.dir=${sdk.replace(/\\/g, '/').replace(/:/g, '\\:')}\n`)
  return { javaHome, sdk }
}

async function ensureModel() {
  const assets = join(cache, 'model-assets')
  const target = join(assets, 'model-en-in')
  if (existsSync(join(target, 'uuid'))) return assets
  mkdirSync(cache, { recursive: true })
  const zip = join(cache, `${MODEL}.zip`)
  if (!existsSync(zip) || statSync(zip).size < 30e6) {
    step(`Downloading the offline wake-word model (${MODEL}, ~37 MB)`)
    const res = await fetch(MODEL_URL)
    if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(`${zip}.part`))
    renameSync(`${zip}.part`, zip)
  }
  step('Unpacking the model')
  const out = join(cache, 'models')
  mkdirSync(out, { recursive: true })
  // Windows 10+ ships bsdtar, which reads .zip; elsewhere use unzip
  if (win) execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', zip, '-C', out], { stdio: 'inherit' })
  else execFileSync('unzip', ['-oq', zip, '-d', out], { stdio: 'inherit' })
  rmSync(target, { recursive: true, force: true })
  mkdirSync(assets, { recursive: true })
  cpSync(join(out, MODEL), target, { recursive: true })
  // the app copies the model out of the APK once, and again only when this id changes
  writeFileSync(join(target, 'uuid'), `${MODEL}\n`)
  return assets
}

function ensureKeystore(javaHome) {
  const dir = join(homedir(), '.lakshya')
  const props = join(dir, 'keystore.properties')
  if (existsSync(props)) return props
  step('Creating your personal signing key (one time)')
  mkdirSync(dir, { recursive: true })
  const store = join(dir, 'jarvis-release.jks')
  const pass = randomBytes(18).toString('base64url')
  execFileSync(join(javaHome, 'bin', win ? 'keytool.exe' : 'keytool'), [
    '-genkeypair', '-keystore', store, '-alias', 'jarvis', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '36500',
    '-storepass', pass, '-keypass', pass, '-dname', 'CN=Lakshya Jarvis', '-noprompt',
  ], { stdio: 'inherit' })
  writeFileSync(props, [`storeFile=${store.replace(/\\/g, '/')}`, `storePassword=${pass}`, 'keyAlias=jarvis', `keyPassword=${pass}`, ''].join('\n'))
  console.log(`  Saved in ${dir}. Back this folder up: future updates must be signed with the same key.`)
  return props
}

async function main() {
  const { javaHome, sdk } = findTools()
  const modelAssets = await ensureModel()
  const keystoreProps = ensureKeystore(javaHome)

  const envLocal = join(root, '.env.local')
  if (!existsSync(envLocal) || !/VITE_SUPABASE_URL=\S+/.test(readFileSync(envLocal, 'utf8'))) {
    throw new Error('.env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY is needed (the APK talks to your real Supabase project).')
  }

  step('Building the web app for Android (Jarvis on)')
  run('npx', ['tsc', '--noEmit', '-p', '.'])
  run('npx', ['vite', 'build', '--mode', 'android'])

  step('Copying it into the Android project')
  run('npx', ['cap', 'sync', 'android'])

  step('Compiling the APK (first run downloads ~500 MB of build tools)')
  const buildDir = join(cache, 'build')
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    LAKSHYA_ANDROID_BUILD_DIR: buildDir,
    LAKSHYA_MODEL_ASSETS: modelAssets,
    LAKSHYA_KEYSTORE_PROPS: keystoreProps,
    // some networks time out on IPv6 for Java while curl works
    GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true`.trim(),
  }
  // full, quoted path: Windows may refuse to run scripts from the current folder by bare name
  const gradlew = join(root, 'android', win ? 'gradlew.bat' : 'gradlew')
  run(win ? `"${gradlew}"` : gradlew, ['assembleRelease', '--console=plain', '--project-cache-dir', `"${join(cache, 'gradle-project-cache')}"`], { cwd: join(root, 'android'), env })

  const apk = join(buildDir, 'app', 'outputs', 'apk', 'release', 'app-release.apk')
  if (!existsSync(apk)) throw new Error(`APK not found at ${apk}`)
  mkdirSync(join(root, 'release'), { recursive: true })
  const outApk = join(root, 'release', 'Lakshya-Jarvis.apk')
  cpSync(apk, outApk)
  console.log(`\n✅ ${outApk} (${(statSync(outApk).size / 1e6).toFixed(1)} MB)\n   Copy it to your phone and open it to install (allow "Install unknown apps" once).`)
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`)
  process.exit(1)
})
