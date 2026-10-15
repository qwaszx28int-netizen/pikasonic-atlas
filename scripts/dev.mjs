import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    process.exit(code)
  }, 2000)
  timer.unref()
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve)),
    ),
  ).then(() => process.exit(code))
}
for (const args of [
  ['server/index.mjs'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
]) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
    windowsHide: true,
  })
  children.push(child)
  child.once('error', (error) => {
    console.error(error.message)
    stop(1)
  })
  child.once('exit', (code) => {
    if (!stopping) stop(code || 0)
  })
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => stop(0))
process.once('exit', () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
})
