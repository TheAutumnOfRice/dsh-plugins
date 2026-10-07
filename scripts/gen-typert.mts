/**
 * gen-typert: regenerate the Typert face artifacts (lib/typert.host.*,
 * lib/typert.remote-client.*) for the packages in this repo with `./typert`
 * and `./remote` exports.
 *
 * Why the overlay: the published @deepseek-ai/dsh-typert-generator analyzer
 * is monorepo-coupled — its Remote marker detection and merged-interface face
 * attribution require every contributing package (typert-protocol, session,
 * …) to be a registered workspace SOURCE package under the generator root,
 * which npm-installed copies never satisfy (the cascade ends at vendoring the
 * whole dependency graph). The plugin sources moved out of the harness
 * monorepo into this repo (harness commit "remove migrated plugin packages"),
 * so generation runs against a scratch OVERLAY: an APFS clonefile copy of the
 * harness checkout (packages, vendor, native, apps, node_modules, face
 * tsconfigs) with this repo's typert packages copied in as real directories
 * (the analyzer realpaths package roots, so symlinks would be filtered out)
 * and referenced from the overlay's tsconfig.host.json. The overlay root
 * keeps the harness layout, so the harness tsconfig.base.json source-plane
 * paths resolve every @deepseek-ai/* import exactly as the in-tree generation
 * did, and the copied manifests already carry the @khorsheed self-name the
 * generator stamps into identifiers and the manifest owner field.
 *
 * The overlay lives under $DSH_HOME/scratch (default ~/.dsh/scratch), one
 * per process (concurrent `pnpm -r build` invocations must not share mutable
 * scratch), cloned fresh from the current harness checkout (DSH_HARNESS,
 * default ~/code/deepseek-harness) on every run — a stale overlay tests
 * yesterday's API surface — and removed when generation finishes. The
 * harness checkout itself is never modified.
 *
 * Freshness cache: one full-mode run already regenerates every registered
 * package's outputs, yet `pnpm -r build` invokes this script once per typert
 * package (~45s of overlay + analysis each — the majority of a full-repo
 * build). Full-mode runs therefore consult a stamp at
 * $DSH_HOME/scratch/typert-cache.json: a key over the generator inputs (this
 * script, every registered package's src/package.json/host configs, and the
 * harness checkout's git HEAD + status) plus the sha256 of every output file
 * the stamp claims. Any input change, any missing/modified output, or a
 * dirty harness checkout misses and regenerates; GEN_TYPERT_FORCE=1 forces a
 * miss. Scoped GEN_TYPERT_ONLY runs (the deploy path) never read or write the
 * cache — a deploy always generates against live sources, and scoped output
 * (siblings resolved from built lib/types) must not poison the full-mode
 * stamp. Concurrent invocations serialize on a lock dir; the loser re-checks
 * the stamp and usually finds it fresh.
 *
 * Usage: tsx scripts/gen-typert.mts
 *
 * With no filter, generates the full known set in one analysis batch. A
 * `GEN_TYPERT_ONLY` build scopes analysis to the named plugin packages plus
 * the typert siblings they declare as dependencies/peerDependencies — an
 * unselected sibling resolves from its built lib/types, which is not a
 * registered face contributor, so a face reaching the sibling's merged
 * declarations (room → local-agent's SessionEventMap augmentation) needs the
 * sibling in the batch; unrelated packages stay unselected, so a broken
 * neighbor still cannot block the batch.
 * Every selected set still runs as one batch because the generator's shared
 * type-declaration metadata depends on the analyzed set.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The harness's own TypeScript (v5 API surface; this repo's typescript@7 differs). */
interface JsoncParser {
  parseConfigFileTextToJson(fileName: string, text: string): { config?: unknown, error?: { messageText: unknown } }
  flattenDiagnosticMessageText(messageText: unknown, newLine: string): string
}

export interface TypertPackage {
  /** This repo's package directory (relative to the repo root). */
  readonly dir: string
  /** The package's @khorsheed name — what the overlay manifest declares. */
  readonly name: string
  /** Aggregate reference targets, relative to the overlay package dir. */
  readonly hostConfigs: readonly string[]
}

/** Packages with ./typert + ./remote exports. */
export const TYPERT_PACKAGES: readonly TypertPackage[] = [
  {
    dir: 'packages/message-tools',
    name: '@khorsheed/dsh-client-message-tools',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/file-preview',
    name: '@khorsheed/dsh-file-preview',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/eval',
    name: '@khorsheed/dsh-eval',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/datasets',
    name: '@khorsheed/dsh-datasets',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/mission',
    name: '@khorsheed/dsh-mission',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/local-agent',
    name: '@khorsheed/dsh-local-agent',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/worktrees',
    name: '@khorsheed/dsh-worktrees',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/local-files',
    name: '@khorsheed/dsh-local-files',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/capability-catalog',
    name: '@khorsheed/dsh-capability-catalog',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/room',
    name: '@khorsheed/dsh-room',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/canvas',
    name: '@khorsheed/dsh-canvas',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/sidechat',
    name: '@khorsheed/dsh-sidechat',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/quote',
    name: '@khorsheed/dsh-quote',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/dsh-reader',
    name: '@khorsheed/dsh-reader',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/capture',
    name: '@khorsheed/dsh-capture',
    hostConfigs: ['tsconfig.host.json'],
  },
]

interface RemoteArtifact {
  readonly js: string
  readonly dts: string
  readonly dtsMap: string
}

interface FaceArtifact {
  readonly package: string
  readonly face: string
  readonly js: string
  readonly dts: string
  readonly remote?: RemoteArtifact
  readonly packageRoot: string
}

interface WorkspaceGenerator {
  generate(packages?: readonly string[], faces?: readonly string[]): FaceArtifact[]
}

// `new URL(...).pathname` is a URL path, not a filesystem path: on Windows it
// yields "/F:/project/dsh-plugins/", and joining it produced "F:\F:\project\…"
// (every readFileSync below then ENOENTs). fileURLToPath is the fs spelling.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
// One overlay per process: `pnpm -r build` invokes this script from several
// package builds concurrently, and a shared directory would race rm/copy.
const overlay = join(dshHome, 'scratch', 'typert-overlay', `${process.pid}-${Date.now()}`)

/** Top-level harness entries the host-face analysis can reach. */
const HARNESS_ENTRIES = [
  'packages',
  'vendor',
  'native',
  'apps',
  'node_modules',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.host.json',
] as const

/**
 * Resolve the plugin packages included in one generation batch.
 *
 * A scoped batch auto-expands over declared intra-repo edges (dependencies /
 * peerDependencies naming another typert package): the scoped overlay maps an
 * UNSELECTED sibling to its built `lib/types`, which is not a registered face
 * contributor — a face that reaches the sibling's declarations then fails the
 * analysis ("merged interface … outside this face": room's face hits
 * local-agent's SessionEventMap augmentation) or crashes naming its exports.
 * The declared edge is exactly what makes the sibling's types resolvable in
 * the first place, so generating them together keeps scoped output identical
 * to a full run's. Unrelated packages stay unselected — a neighbor's broken
 * WIP still cannot block this batch.
 */
export function selectTypertPackages(only: string | undefined): readonly TypertPackage[] {
  const names = only?.split(',').map(name => name.trim()).filter(Boolean)
  const selected = names !== undefined && names.length > 0
    ? TYPERT_PACKAGES.filter(pkg => names.includes(pkg.name))
    : [...TYPERT_PACKAGES]
  if (selected.length === 0) throw new Error('gen-typert: GEN_TYPERT_ONLY matched no registered package')
  if (names === undefined || names.length === 0) return selected
  const queue = [...selected]
  for (let i = 0; i < queue.length; i++) {
    const pkg = queue[i] as TypertPackage
    let manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
    try {
      manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, 'package.json'), 'utf8')) as typeof manifest
    } catch { continue }
    for (const edge of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      const sibling = TYPERT_PACKAGES.find(candidate => candidate.name === edge)
      if (sibling !== undefined && !queue.includes(sibling)) queue.push(sibling)
    }
  }
  return queue
}

/** Copy only the selected plugin sources and compiler inputs into an overlay. */
export function copyTypertPackageSources(
  packages: readonly TypertPackage[],
  sourceRoot: string,
  targetRoot: string,
): void {
  for (const pkg of packages) {
    const target = join(targetRoot, pkg.dir)
    mkdirSync(target, { recursive: true })
    cpSync(join(sourceRoot, pkg.dir, 'src'), join(target, 'src'), { recursive: true })
    cpSync(join(sourceRoot, pkg.dir, 'package.json'), join(target, 'package.json'))
    for (const config of pkg.hostConfigs) {
      cpSync(join(sourceRoot, pkg.dir, config), join(target, config))
    }
  }
}

/**
 * Copy the BUILT declaration files of registered packages OUTSIDE the
 * selected set into the overlay. A selected package may hold a TYPE-only
 * import of a family sibling (e.g. room reading the local-agent facade's
 * types); in scoped generation the sibling's source is deliberately absent
 * (its in-flight breakage must not fail this batch), so the import resolves
 * from the sibling's built `lib/types` instead. A sibling without a built
 * `lib/types` is skipped — an actual import of it fails with the plain
 * TS2307, which then means "build the sibling first".
 *
 * A copied sibling is NOT a registered face contributor (no package.json, no
 * project reference lands in the overlay): its types resolve for identity,
 * but face emission cannot name its exports. A selected package whose FACE
 * reaches a sibling's declarations (room's SessionEventMap merge members
 * typed with local-agent's stream checkpoint) must therefore name the sibling
 * in GEN_TYPERT_ONLY — `selectTypertPackages` expands declared edges
 * automatically, so this stays correct by construction.
 * @param selected - the packages whose sources ARE overlaid.
 * @param sourceRoot - this repo's root.
 * @param targetRoot - the overlay root.
 */
export function copyTypertSiblingTypes(
  selected: readonly TypertPackage[],
  sourceRoot: string,
  targetRoot: string,
): void {
  for (const pkg of TYPERT_PACKAGES) {
    if (selected.includes(pkg)) continue
    const types = join(sourceRoot, pkg.dir, 'lib', 'types')
    if (!existsSync(join(types, 'index.d.ts'))) continue
    cpSync(types, join(targetRoot, pkg.dir, 'lib', 'types'), { recursive: true })
  }
}

/**
 * The overlay tsconfig `paths` entries resolving unselected siblings to their
 * copied `lib/types` (see `copyTypertSiblingTypes`). Selected packages keep
 * their source-plane mapping and are never listed here.
 * @param selected - the packages whose sources ARE overlaid.
 * @param sourceRoot - this repo's root.
 * @returns `paths` entries for unselected siblings with a built `lib/types`.
 */
export function typertSiblingTypePaths(
  selected: readonly TypertPackage[],
  sourceRoot: string,
): Record<string, string[]> {
  const paths: Record<string, string[]> = {}
  for (const pkg of TYPERT_PACKAGES) {
    if (selected.includes(pkg)) continue
    if (!existsSync(join(sourceRoot, pkg.dir, 'lib', 'types', 'index.d.ts'))) continue
    paths[pkg.name] = [`./${pkg.dir}/lib/types/index.d.ts`]
    paths[`${pkg.name}/*`] = [`./${pkg.dir}/lib/types/*`]
  }
  return paths
}

/** Rebuild the overlay from the harness checkout, selected plugin packages overlaid. */
async function buildOverlay(packages: readonly TypertPackage[]): Promise<void> {
  const ts = await import(pathToFileURL(join(harness, 'node_modules/typescript/lib/typescript.js')).href) as JsoncParser
  rmSync(overlay, { recursive: true, force: true })
  mkdirSync(overlay, { recursive: true })
  for (const entry of HARNESS_ENTRIES) {
    const source = join(harness, entry)
    if (!existsSync(source)) throw new Error(`gen-typert: harness entry ${source} not found — build a current checkout or set DSH_HARNESS`)
    // APFS clonefile keeps the copy cheap; fall back to a plain copy elsewhere.
    try {
      execFileSync('cp', ['-c', '-R', source, join(overlay, entry)])
    } catch {
      cpSync(source, join(overlay, entry), { recursive: true, verbatimSymlinks: true })
    }
  }
  copyTypertPackageSources(packages, repoRoot, overlay)
  copyTypertSiblingTypes(packages, repoRoot, overlay)
  // The harness tsconfig.base.json maps only @deepseek-ai/*; overlaid packages
  // must also resolve each other's @khorsheed/* specifiers (cross-package
  // TYPE-only imports, e.g. room reading the local-agent facade's types).
  // Selected packages resolve from SOURCE; unselected siblings resolve from
  // their built lib/types, so a sibling's in-flight source state cannot fail
  // a scoped batch. The overlay is scratch, so patching the copied base is safe.
  const basePath = join(overlay, 'tsconfig.base.json')
  const baseParsed = ts.parseConfigFileTextToJson(basePath, readFileSync(basePath, 'utf8'))
  if (baseParsed.error !== undefined) {
    throw new Error(`gen-typert: cannot parse harness tsconfig.base.json: ${ts.flattenDiagnosticMessageText(baseParsed.error.messageText, '\n')}`)
  }
  const base = baseParsed.config as { compilerOptions?: { paths?: Record<string, string[]> } }
  const paths: Record<string, string[]> = { ...base.compilerOptions?.paths }
  for (const pkg of packages) {
    paths[pkg.name] = [`./${pkg.dir}/src/index.ts`]
    paths[`${pkg.name}/*`] = [`./${pkg.dir}/src/*`]
  }
  Object.assign(paths, typertSiblingTypePaths(packages, repoRoot))
  // Plugins may import a harness package's source files directly through the
  // package's `./src/*` export (e.g. room registering the persistence
  // vocabulary via '@deepseek-ai/dsh-session/src/known-event-types.ts' so the
  // registration lands in the toolchain's module instance rather than a
  // second lib copy). The harness base maps subpaths individually, so derive
  // the `<pkg>/src/*` form from each mapped subpath's directory.
  for (const [key, targets] of Object.entries(paths)) {
    const match = /^(@deepseek-ai\/[^/]+)\//.exec(key)
    if (match === null || `${match[1]}/src/*` in paths) continue
    const dir = /^\.\/(.+\/src)\//.exec(targets[0] ?? '')
    if (dir !== null) paths[`${match[1]}/src/*`] = [`./${dir[1]}/*`]
  }
  // The 0.1.7-rc.1 host renamed @deepseek-ai/dsh-agent-presets to
  // @deepseek-ai/dsh-agent-preset-registry (API carried over), and plugins
  // dual-name-probe the module at runtime, so the OLD name must still
  // type-check here — the overlay has no node_modules copy of it (the
  // harness no longer ships it, and plugin devDependencies are not overlaid).
  // Alias it onto the new name's source-plane mapping: the surfaces are the
  // same by upstream contract, and every consumer casts structurally anyway.
  const presetRegistryPaths = paths['@deepseek-ai/dsh-agent-preset-registry']
  if (paths['@deepseek-ai/dsh-agent-presets'] === undefined && presetRegistryPaths !== undefined) {
    paths['@deepseek-ai/dsh-agent-presets'] = presetRegistryPaths
  }
  base.compilerOptions = { ...base.compilerOptions, paths }
  writeFileSync(basePath, `${JSON.stringify(base, null, 2)}\n`)
  const aggregatePath = join(overlay, 'tsconfig.host.json')
  const parsed = ts.parseConfigFileTextToJson(aggregatePath, readFileSync(aggregatePath, 'utf8'))
  if (parsed.error !== undefined) {
    throw new Error(`gen-typert: cannot parse harness tsconfig.host.json: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  }
  const aggregate = parsed.config as { references?: Array<{ path: string }> }
  aggregate.references = [
    ...aggregate.references ?? [],
    ...packages.flatMap(pkg => pkg.hostConfigs.map(config => ({ path: `./${pkg.dir}/${config}` }))),
  ]
  writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`)
}

/* ---------------- freshness cache (full mode only, see module header) ---------------- */

/** sha256 hex of one file's contents. */
export function typertFileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Content hash of everything a generation batch reads from THIS repo: the
 * script itself plus, per selected package, package.json, the host configs,
 * and the src tree (exactly what `copyTypertPackageSources` overlays).
 */
export function typertInputHash(repoRoot: string, packages: readonly TypertPackage[], scriptFile: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(scriptFile))
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`)
      else { hash.update(prefix + entry.name); hash.update(readFileSync(path)) }
    }
  }
  for (const pkg of packages) {
    hash.update(pkg.name)
    hash.update(readFileSync(join(repoRoot, pkg.dir, 'package.json')))
    for (const config of pkg.hostConfigs) hash.update(readFileSync(join(repoRoot, pkg.dir, config)))
    walk(join(repoRoot, pkg.dir, 'src'), `${pkg.dir}/src/`)
  }
  return hash.digest('hex')
}

/**
 * The harness checkout's git state (HEAD + `status --porcelain`), or null
 * when unreadable — generation resolves harness sources, so any uncommitted
 * harness change must miss the cache; null means "uncacheable".
 */
export function harnessGitState(harness: string): string | null {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harness, encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: harness, encoding: 'utf8' })
    return createHash('sha256').update(head).update(status).digest('hex')
  } catch {
    return null
  }
}

interface TypertCache {
  readonly key: string
  /** Repo-relative output path → sha256 at generation time. */
  readonly files: Record<string, string>
}

/** The stamp is fresh only when the key matches and every recorded output survives unchanged. */
export function isTypertCacheFresh(cachePath: string, key: string, repoRoot: string): boolean {
  if (!existsSync(cachePath)) return false
  let stamp: TypertCache
  try {
    stamp = JSON.parse(readFileSync(cachePath, 'utf8')) as TypertCache
  } catch {
    return false
  }
  if (stamp.key !== key || typeof stamp.files !== 'object' || stamp.files === null) return false
  for (const [rel, sha] of Object.entries(stamp.files)) {
    const path = join(repoRoot, rel)
    if (!existsSync(path) || typertFileHash(path) !== sha) return false
  }
  return true
}

export function writeTypertCache(cachePath: string, key: string, files: Record<string, string>): void {
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify({ key, files } satisfies TypertCache, null, 2)}\n`)
}

const lockSleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Serialize concurrent full-mode generations; the loser re-reads the stamp.
 *
 * The parent is created first: `mkdirSync(lockDir)` is deliberately
 * non-recursive (an atomic create-or-fail is what makes the directory a lock),
 * so on a DSH_HOME whose `scratch/` does not exist yet it fails with ENOENT —
 * indistinguishable, in the catch below, from "someone else holds the lock".
 * A cold home therefore spun for the full 900-second break deadline, tore down
 * a lock nobody held, and spun again. Nobody hit it because every deployment
 * path set GEN_TYPERT_ONLY and returned before the lock. */
export function acquireTypertLock(lockDir: string): void {
  mkdirSync(dirname(lockDir), { recursive: true })
  let deadline = Date.now() + 900_000
  for (;;) {
    try {
      mkdirSync(lockDir)
      return
    } catch {
      if (Date.now() > deadline) {
        // A crashed generator leaves the dir behind; break it and keep going —
        // the worst case is a duplicate generation with identical outputs.
        rmSync(lockDir, { recursive: true, force: true })
        deadline = Date.now() + 60_000
      }
      lockSleep(1000)
    }
  }
}

export function releaseTypertLock(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true })
}

/**
 * Dual-shape strict codecs for the 0.1.5↔rc.1 loader split. The 0.1.5
 * typert-loader validates (and consumes) an EAGER zod instance at
 * `codec.schema` (packages/typert/loader/src/index.ts:263-274 @ 0.1.5) and
 * does not reject unknown keys; rc.1 validates (and consumes) a LAZY factory
 * at `codec.create` (same function, :265-284 @ rc.1) and likewise tolerates
 * extras. The rc.1 generator emits only `create`. Materializing the same
 * factory once as `schema: <factory>()` therefore satisfies both loaders at
 * zero cost on either: the factory's own `$value` memoization makes the eager
 * call return the one instance every later `create()` also hands out, and
 * every factory const is declared before the TYPERT manifest literal that
 * references it (verified across all 30 generated faces), so the call is
 * TDZ-safe. The single `create: <identifier>,` literal shape covers every
 * emission site — invocation parameter/result/Context codecs and
 * TYPERT.schemas entries alike.
 */
export function dualShapeCodecs(content: string): string {
  return content.replace(/^([ \t]*)create: ([A-Za-z0-9_$]+),$/gm, '$1create: $2,\n$1schema: $2(),')
}

/** Run one generation batch; returns the repo-relative outputs written, hashed. */
async function generate(selected: readonly TypertPackage[]): Promise<Record<string, string>> {
  const generatorModule = join(harness, 'packages/typert/generator/src/workspace.ts')
  if (!existsSync(generatorModule)) {
    throw new Error(`gen-typert: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  const written: Record<string, string> = {}
  const write = (out: string, name: string, content: string): void => {
    const path = join(out, name)
    const finalContent = name.endsWith('.js') ? dualShapeCodecs(content) : content
    writeFileSync(path, finalContent)
    written[relative(repoRoot, path)] = createHash('sha256').update(finalContent).digest('hex')
  }
  await buildOverlay(selected)
  try {
    const { WorkspaceTypertGenerator } = await import(pathToFileURL(generatorModule).href) as {
      WorkspaceTypertGenerator: new (root: string) => WorkspaceGenerator
    }
    const generator = new WorkspaceTypertGenerator(overlay)
    const artifacts = generator.generate(selected.map(pkg => pkg.name), ['host'])
    for (const pkg of selected) {
      const own = artifacts.filter(artifact => artifact.package === pkg.name)
      if (own.length === 0) throw new Error(`gen-typert: no host artifact generated for ${pkg.name}`)
      const out = join(repoRoot, pkg.dir, 'lib')
      mkdirSync(out, { recursive: true })
      for (const artifact of own) {
        write(out, `typert.${artifact.face}.js`, artifact.js)
        write(out, `typert.${artifact.face}.d.ts`, artifact.dts)
        if (artifact.remote !== undefined) {
          write(out, 'typert.remote-client.js', artifact.remote.js)
          write(out, 'typert.remote-client.d.ts', artifact.remote.dts)
          write(out, 'typert.remote-client.d.ts.map', artifact.remote.dtsMap)
        }
      }
      console.log(`gen-typert: ${pkg.name} generated from overlay ${overlay}`)
    }
  } finally {
    rmSync(overlay, { recursive: true, force: true })
  }
  return written
}

async function main(): Promise<void> {
  // GEN_TYPERT_ONLY=<name,name> restricts generation to a subset — one
  // package's in-flight remote-surface breakage must not block every other
  // package's build in a multi-agent repo (observed: mission WIP failing
  // message-tools' gen-typert). Default: all registered typert packages.
  const only = process.env['GEN_TYPERT_ONLY']
  const selected = selectTypertPackages(only)
  // Scoped runs (the deploy path) always generate live and never touch the
  // stamp: a deploy's outputs must reflect the current sources, and scoped
  // output (siblings resolved from built lib/types) differs from full mode.
  if (only !== undefined) {
    await generate(selected)
    return
  }
  const forced = process.env['GEN_TYPERT_FORCE'] === '1'
  const cachePath = join(dshHome, 'scratch', 'typert-cache.json')
  const lockDir = join(dshHome, 'scratch', 'typert-gen.lock')
  const state = harnessGitState(harness)
  const key = state === null
    ? null
    : createHash('sha256')
      .update(typertInputHash(repoRoot, selected, fileURLToPath(import.meta.url)))
      .update(state)
      .digest('hex')
  const fresh = (): boolean => key !== null && isTypertCacheFresh(cachePath, key, repoRoot)
  if (!forced && fresh()) {
    console.log(`gen-typert: ${selected.length} packages fresh (key ${key!.slice(0, 12)}) — skipping (GEN_TYPERT_FORCE=1 to regenerate)`)
    return
  }
  acquireTypertLock(lockDir)
  try {
    // The lock winner may have just refreshed every output this run needs.
    if (!forced && fresh()) {
      console.log(`gen-typert: ${selected.length} packages fresh after lock (key ${key!.slice(0, 12)}) — skipping`)
      return
    }
    const written = await generate(selected)
    if (key !== null) writeTypertCache(cachePath, key, written)
  } finally {
    releaseTypertLock(lockDir)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
