import { useState, useRef, useCallback, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import './App.css'

// Use absolute URLs — same-origin files don't need toBlobURL proxying
const ST_BASE = () => `${location.origin}/ffmpeg-st`
const MT_BASE = () => `${location.origin}/ffmpeg-mt`

function buildArgs(inputName) {
  return ['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-an', 'output.mp4']
}

function useBenchmark(type) {
  const ffmpegRef = useRef(null)
  const loadedRef = useRef(false)
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(null)
  const [logs, setLogs] = useState([])

  const reset = useCallback(() => {
    setStatus('idle')
    setProgress(0)
    setElapsed(null)
    setLogs([])
  }, [])

  const run = useCallback(async (file) => {
    if (!ffmpegRef.current) {
      const ff = new FFmpeg()
      ff.on('log', ({ message }) => {
        setLogs(prev => [...prev, message].slice(-80))
      })
      ff.on('progress', ({ progress: p }) => {
        setProgress(Math.min(99, Math.round(p * 100)))
      })
      ffmpegRef.current = ff
    }

    const ffmpeg = ffmpegRef.current
    setStatus('loading')
    setProgress(0)
    setLogs([])
    setElapsed(null)

    try {
      if (!loadedRef.current) {
        if (type === 'st') {
          await ffmpeg.load({
            coreURL: `${ST_BASE()}/ffmpeg-core.js`,
            wasmURL: `${ST_BASE()}/ffmpeg-core.wasm`,
          })
        } else {
          await ffmpeg.load({
            coreURL: `${MT_BASE()}/ffmpeg-core.js`,
            wasmURL: `${MT_BASE()}/ffmpeg-core.wasm`,
            workerURL: `${MT_BASE()}/ffmpeg-core.worker.js`,
          })
        }
        loadedRef.current = true
      }

      const ext = file.name.split('.').pop() || 'mp4'
      const inputName = `input.${ext}`
      setStatus('running')
      const start = performance.now()
      await ffmpeg.writeFile(inputName, await fetchFile(file))
      await ffmpeg.exec(buildArgs(inputName))
      const end = performance.now()

      setElapsed(Math.round(end - start))
      setProgress(100)
      setStatus('done')

      try { await ffmpeg.deleteFile(inputName) } catch { }
      try { await ffmpeg.deleteFile('output.mp4') } catch { }
    } catch (err) {
      setStatus('error')
      console.error('ffmpeg error:', err)
      const msg = err instanceof Error ? err.message : typeof err === 'number' ? `ffmpeg exited with code ${err}` : String(err ?? 'unknown error')
      setLogs(prev => [...prev, `ERROR: ${msg}`])
    }
  }, [type])

  return { status, progress, elapsed, logs, run, reset }
}

function DropZone({ onFile, file }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      {file ? (
        <>
          <div className="file-icon">🎬</div>
          <div className="file-name">{file.name}</div>
          <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB — click to change</div>
        </>
      ) : (
        <>
          <div className="drop-icon">📂</div>
          <div className="drop-text">Drop a video file here</div>
          <div className="drop-sub">or click to select · MP4, MKV, AVI, MOV…</div>
        </>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    idle: { label: 'Idle', cls: 'badge-idle' },
    loading: { label: 'Loading WASM…', cls: 'badge-loading' },
    running: { label: 'Running', cls: 'badge-running' },
    done: { label: 'Done', cls: 'badge-done' },
    error: { label: 'Error', cls: 'badge-error' },
  }
  const { label, cls } = map[status] || map.idle
  return <span className={`badge ${cls}`}>{label}</span>
}

function ProgressBar({ value, color }) {
  return (
    <div className="progress-track">
      <div
        className="progress-fill"
        style={{ width: `${value}%`, background: color }}
      />
      <span className="progress-label">{value}%</span>
    </div>
  )
}

function BenchmarkCard({ title, type, accentColor, file, disabled }) {
  const { status, progress, elapsed, logs, run, reset } = useBenchmark(type)
  const [showLogs, setShowLogs] = useState(false)
  const logsEndRef = useRef(null)

  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, showLogs])

  const isRunning = status === 'loading' || status === 'running'

  return (
    <div className="benchmark-card" style={{ '--accent': accentColor }}>
      <div className="card-header">
        <h2>{title}</h2>
        <StatusBadge status={status} />
      </div>

      <div className="card-type-label">
        {type === 'st'
          ? 'Single-threaded WASM · @ffmpeg/core'
          : 'Multi-threaded WASM · @ffmpeg/core-mt'}
      </div>

      {type === 'mt' && typeof SharedArrayBuffer === 'undefined' && (
        <div className="sab-warning">
          ⚠️ SharedArrayBuffer unavailable — multi-threading requires Cross-Origin Isolation headers.
          Run via <code>npm run dev</code> which sets COOP/COEP automatically.
        </div>
      )}

      <ProgressBar value={progress} color={accentColor} />

      <div className="card-actions">
        <button
          className="btn-run"
          style={{ '--accent': accentColor }}
          onClick={() => run(file)}
          disabled={!file || isRunning || disabled}
        >
          {isRunning ? (status === 'loading' ? 'Loading WASM…' : 'Encoding…') : 'Run Test'}
        </button>
        {status !== 'idle' && !isRunning && (
          <button className="btn-reset" onClick={reset}>Reset</button>
        )}
      </div>

      {elapsed !== null && (
        <div className="elapsed">
          <span className="elapsed-num">{(elapsed / 1000).toFixed(2)}s</span>
          <span className="elapsed-label">encode time</span>
        </div>
      )}

      <button
        className="btn-logs"
        onClick={() => setShowLogs(v => !v)}
        disabled={logs.length === 0}
      >
        {showLogs ? '▲ Hide logs' : '▼ Show logs'} ({logs.length})
      </button>

      {showLogs && (
        <div className="log-viewer">
          {logs.map((line, i) => <div key={i} className="log-line">{line}</div>)}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  )
}

function Results({ stElapsed, mtElapsed }) {
  if (!stElapsed && !mtElapsed) return null

  const speedup = stElapsed && mtElapsed ? (stElapsed / mtElapsed).toFixed(2) : null
  const faster = speedup > 1 ? 'multi-core' : speedup < 1 ? 'single-core' : 'tied'

  return (
    <div className="results">
      <h2>Results</h2>
      <div className="results-grid">
        <div className="result-item">
          <div className="result-label">Single-core</div>
          <div className="result-val st">
            {stElapsed ? `${(stElapsed / 1000).toFixed(2)}s` : '—'}
          </div>
        </div>
        <div className="result-item">
          <div className="result-label">Multi-core</div>
          <div className="result-val mt">
            {mtElapsed ? `${(mtElapsed / 1000).toFixed(2)}s` : '—'}
          </div>
        </div>
        {speedup && (
          <div className="result-item result-speedup">
            <div className="result-label">Speedup</div>
            <div className="result-val speedup">
              {speedup}×
              <span className="speedup-note">{faster} is faster</span>
            </div>
          </div>
        )}
      </div>
      <div className="results-meta">
        Command: <code>{buildArgs('input.mp4').join(' ')}</code>
      </div>
      <div className="results-meta">
        CPU cores: <code>{navigator.hardwareConcurrency ?? 'unknown'}</code> ·
        SharedArrayBuffer: <code>{typeof SharedArrayBuffer !== 'undefined' ? 'available ✓' : 'unavailable ✗'}</code>
      </div>
    </div>
  )
}

export default function App() {
  const [file, setFile] = useState(null)
  const [stElapsed, setStElapsed] = useState(null)
  const [mtElapsed, setMtElapsed] = useState(null)

  // We lift elapsed state up so Results can read it
  // Cards manage their own FFmpeg instances; we sync elapsed via callback
  const stRef = useRef(null)
  const mtRef = useRef(null)

  return (
    <div className="app">
      <header className="app-header">
        <h1>ffmpeg.wasm Benchmark</h1>
        <p className="subtitle">
          Compare single-core vs multi-core WebAssembly video encoding in the browser
        </p>
        <div className="env-badges">
          <span className="env-badge">
            {typeof SharedArrayBuffer !== 'undefined' ? '✓ Cross-Origin Isolated' : '✗ Not Cross-Origin Isolated'}
          </span>
          <span className="env-badge">
            {navigator.hardwareConcurrency ?? '?'} CPU threads
          </span>
        </div>
      </header>

      <main className="app-main">
        <DropZone file={file} onFile={setFile} />

        {file && (
          <p className="encode-note">
            The app will transcode your video using <strong>libx264 ultrafast</strong> (no audio).
            The same operation runs twice — once with the single-threaded WASM core and once with the multi-threaded core.
          </p>
        )}

        <div className="cards">
          <BenchmarkCardWithSync
            title="Single-Core"
            type="st"
            accentColor="#3b82f6"
            file={file}
            onElapsed={setStElapsed}
          />
          <BenchmarkCardWithSync
            title="Multi-Core"
            type="mt"
            accentColor="#8b5cf6"
            file={file}
            onElapsed={setMtElapsed}
          />
        </div>

        <Results stElapsed={stElapsed} mtElapsed={mtElapsed} />
      </main>

      <footer className="app-footer">
        ffmpeg.wasm · @ffmpeg/ffmpeg@0.12 · React + Vite
      </footer>
    </div>
  )
}

// Wrapper that syncs elapsed to parent
function BenchmarkCardWithSync({ title, type, accentColor, file, onElapsed }) {
  const ffmpegRef = useRef(null)
  const loadedRef = useRef(false)
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(null)
  const [logs, setLogs] = useState([])
  const [showLogs, setShowLogs] = useState(false)
  const logsEndRef = useRef(null)

  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, showLogs])

  const run = async () => {
    if (!ffmpegRef.current) {
      const ff = new FFmpeg()
      ff.on('log', ({ message }) => {
        setLogs(prev => [...prev, message].slice(-80))
      })
      ff.on('progress', ({ progress: p }) => {
        setProgress(Math.min(99, Math.round(p * 100)))
      })
      ffmpegRef.current = ff
    }

    const ffmpeg = ffmpegRef.current
    setStatus('loading')
    setProgress(0)
    setLogs([])
    setElapsed(null)
    onElapsed(null)

    try {
      if (!loadedRef.current) {
        if (type === 'st') {
          await ffmpeg.load({
            coreURL: `${ST_BASE()}/ffmpeg-core.js`,
            wasmURL: `${ST_BASE()}/ffmpeg-core.wasm`,
          })
        } else {
          await ffmpeg.load({
            coreURL: `${MT_BASE()}/ffmpeg-core.js`,
            wasmURL: `${MT_BASE()}/ffmpeg-core.wasm`,
            workerURL: `${MT_BASE()}/ffmpeg-core.worker.js`,
          })
        }
        loadedRef.current = true
      }

      const ext = file.name.split('.').pop() || 'mp4'
      const inputName = `input.${ext}`
      setStatus('running')
      const start = performance.now()
      await ffmpeg.writeFile(inputName, await fetchFile(file))
      await ffmpeg.exec(buildArgs(inputName))
      const ms = Math.round(performance.now() - start)

      setElapsed(ms)
      onElapsed(ms)
      setProgress(100)
      setStatus('done')

      try { await ffmpeg.deleteFile(inputName) } catch { }
      try { await ffmpeg.deleteFile('output.mp4') } catch { }
    } catch (err) {
      setStatus('error')
      console.error('ffmpeg error:', err)
      const msg = err instanceof Error ? err.message : typeof err === 'number' ? `ffmpeg exited with code ${err}` : String(err ?? 'unknown error')
      setLogs(prev => [...prev, `ERROR: ${msg}`])
    }
  }

  const reset = () => {
    setStatus('idle')
    setProgress(0)
    setElapsed(null)
    setLogs([])
    onElapsed(null)
  }

  const isRunning = status === 'loading' || status === 'running'

  return (
    <div className="benchmark-card" style={{ '--accent': accentColor }}>
      <div className="card-header">
        <h2>{title}</h2>
        <StatusBadge status={status} />
      </div>

      <div className="card-type-label">
        {type === 'st'
          ? 'Single-threaded · @ffmpeg/core'
          : 'Multi-threaded · @ffmpeg/core-mt'}
      </div>

      {type === 'mt' && typeof SharedArrayBuffer === 'undefined' && (
        <div className="sab-warning">
          ⚠️ SharedArrayBuffer not available. Run via <code>npm run dev</code> to enable COOP/COEP headers required for multi-threading.
        </div>
      )}

      <ProgressBar value={progress} color={accentColor} />

      <div className="card-actions">
        <button
          className="btn-run"
          style={{ '--accent': accentColor }}
          onClick={run}
          disabled={!file || isRunning}
        >
          {isRunning
            ? status === 'loading' ? 'Loading WASM…' : 'Encoding…'
            : status === 'done' ? 'Run Again' : 'Run Test'}
        </button>
        {status !== 'idle' && !isRunning && (
          <button className="btn-reset" onClick={reset}>Reset</button>
        )}
      </div>

      {elapsed !== null && (
        <div className="elapsed">
          <span className="elapsed-num">{(elapsed / 1000).toFixed(2)}s</span>
          <span className="elapsed-label">encode time</span>
        </div>
      )}

      <button
        className="btn-logs"
        onClick={() => setShowLogs(v => !v)}
        disabled={logs.length === 0}
      >
        {showLogs ? '▲ Hide logs' : '▼ Show logs'} ({logs.length})
      </button>

      {showLogs && (
        <div className="log-viewer">
          {logs.map((line, i) => <div key={i} className="log-line">{line}</div>)}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  )
}
