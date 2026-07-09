import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Check,
  Code2,
  Cpu,
  Download,
  FileText,
  HardDrive,
  MessageSquareText,
  Microchip,
  Power as PowerIcon,
  Scale,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getDesktop } from './desktop'
import { clamp, formatBytes, formatNumber } from './ui'
import type { HardwareProfile, Recommendation, UseCase } from './types'
import type { DownloadState } from './views'

const bridge = getDesktop()
const isMac = bridge.platform === 'darwin'
const machineNoun = isMac ? 'Mac' : 'PC'

type Step = 'scan' | 'floor' | 'intent' | 'priority' | 'recommend'

type Priority = 'speed' | 'balanced' | 'quality'

const USE_CASE_OPTIONS: Array<{ id: UseCase; label: string; body: string; icon: LucideIcon }> = [
  {
    id: 'everyday',
    label: 'Everyday assistant',
    body: 'Writing, questions, summaries, ideas — a general helper.',
    icon: MessageSquareText,
  },
  {
    id: 'coding',
    label: 'Coding',
    body: 'Write, edit and explain code; help with development work.',
    icon: Code2,
  },
  {
    id: 'agents',
    label: 'Agents & tools',
    body: 'Connect tools and MCP servers so the model can take actions.',
    icon: Wrench,
  },
  {
    id: 'documents',
    label: 'Private documents',
    body: 'Long documents and files that must never leave this Mac.',
    icon: FileText,
  },
  {
    id: 'reasoning',
    label: 'Deep reasoning',
    body: 'Math, analysis, and problems that need step-by-step thinking.',
    icon: BrainCircuit,
  },
]

const PRIORITY_OPTIONS: Array<{ id: Priority; label: string; body: string; icon: LucideIcon }> = [
  {
    id: 'speed',
    label: 'Fast',
    body: 'Snappy replies from a lighter model. Great for quick back-and-forth.',
    icon: Zap,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    body: 'The sweet spot for most people — recommended.',
    icon: Scale,
  },
  {
    id: 'quality',
    label: 'Smartest',
    body: 'The most capable model your Mac can run. Replies take longer.',
    icon: Sparkles,
  },
]

export function OnboardingFlow({
  benchmarking = false,
  download,
  onDownload,
  onComplete,
  onSkipToModels,
}: {
  benchmarking?: boolean
  download: DownloadState
  onDownload: (uri: string) => void
  onComplete: (payload: { useCase: string; priority: string }) => void

  onSkipToModels: (payload?: { useCase?: string; priority?: string }) => void
}) {
  const [step, setStep] = useState<Step>('scan')
  const [profile, setProfile] = useState<HardwareProfile | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [useCase, setUseCase] = useState<UseCase | null>(null)
  const [priority, setPriority] = useState<Priority>('balanced')
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const startedDownload = useRef(false)

  useEffect(() => {
    let cancelled = false
    const started = Date.now()
    void bridge.hardware.profile().then((result) => {
      if (cancelled) return

      const wait = Math.max(0, 1400 - (Date.now() - started))
      window.setTimeout(() => {
        if (cancelled) return
        setProfile(result)
        setRevealed(true)
      }, wait)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (startedDownload.current && download === null && useCase) {
      onComplete({ useCase, priority })
    }
  }, [download, onComplete, priority, useCase])

  const fetchRecommendations = useCallback(
    (nextUseCase: UseCase, nextPriority: Priority) => {
      setRecommendations(null)
      void bridge.catalog
        .recommend({ useCase: nextUseCase, priority: nextPriority })
        .then(setRecommendations)
        .catch(() => setRecommendations([]))
    },
    [],
  )

  const ramGb = profile ? profile.totalRamBytes / 1024 ** 3 : 0

  const budgetGb = profile ? profile.usableBudgetBytes / 1e9 : 0

  const chipLabel = useMemo(() => {
    if (!profile) return ''
    return profile.chip ?? (profile.isAppleSilicon ? 'Apple Silicon' : 'Unknown processor')
  }, [profile])

  return (
    <div className="onboarding">
      <header className="ob-brand">
        <PowerIcon size={20} strokeWidth={2.4} />
        <span>PowerStation</span>
      </header>

      {step === 'scan' && (
        <section className="ob-stage">
          {!revealed || !profile ? (
            <div className="ob-scan">
              <div className="ob-scan-pulse" aria-hidden="true">
                <Microchip size={30} />
              </div>
              <h1>Reading your {machineNoun}…</h1>
              <p>PowerStation checks your chip, memory and disk so you never have to guess what fits.</p>
            </div>
          ) : (
            <div className="ob-reveal">
              <span className="ob-eyebrow">Your machine</span>
              <h1>{chipLabel}</h1>
              <div className="ob-hardware-grid">
                <div className="ob-hw-card">
                  <Cpu size={17} />
                  <strong>{formatNumber(ramGb, 0)} GB</strong>
                  <span>{profile.isAppleSilicon ? 'unified memory' : 'system memory'}</span>
                </div>
                <div className="ob-hw-card">
                  <Microchip size={17} />
                  <strong>~{formatNumber(budgetGb, 0)} GB</strong>
                  <span>{profile.gpuBudgetIsMeasured ? 'usable for AI (measured)' : 'usable for AI (estimated)'}</span>
                </div>
                <div className="ob-hw-card">
                  <HardDrive size={17} />
                  <strong>{profile.freeDiskBytes ? formatBytes(profile.freeDiskBytes) : '—'}</strong>
                  <span>free disk space</span>
                </div>
              </div>
              {profile.meetsFloor ? (
                <>
                  <p className="ob-note">
                    Everything runs on this {machineNoun}. Prompts, chats and models never leave it.
                  </p>
                  <button className="primary-button ob-next" type="button" onClick={() => setStep('intent')}>
                    Continue
                    <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <>
                  <p className="ob-note">Let's be honest about what this machine can do.</p>
                  <button className="primary-button ob-next" type="button" onClick={() => setStep('floor')}>
                    Continue
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {step === 'floor' && profile && (
        <section className="ob-stage">
          <div className="ob-floor">
            <span className="ob-floor-icon">
              <AlertTriangle size={22} />
            </span>
            <h1>This {machineNoun} has {formatNumber(ramGb, 0)} GB of memory — below what local AI realistically needs</h1>
            <p>
              Capable local models want <strong>16 GB or more</strong>. With {formatNumber(ramGb, 0)} GB, only very
              small models fit, they compete with the operating system for memory, and agent features won't work
              reliably. We'd rather tell you now than after a download.
            </p>
            <p>
              {isMac
                ? 'For a good experience, use an Apple Silicon Mac with 16 GB+ of unified memory — 24–32 GB is the sweet spot for agents and coding.'
                : 'For a good experience, use a PC with 16 GB+ of RAM — ideally with a discrete GPU (8 GB+ VRAM) so models run at full speed.'}
            </p>
            <div className="ob-floor-actions">
              <button className="secondary-button" type="button" onClick={() => onSkipToModels()}>
                Continue anyway — small models only
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 'intent' && (
        <section className="ob-stage">
          <span className="ob-eyebrow">Question 1 of 2</span>
          <h1>What will you mainly use it for?</h1>
          <p className="ob-sub">This decides which models we recommend — not just what fits, but what's good at your work.</p>
          <div className="ob-option-grid">
            {USE_CASE_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  type="button"
                  className={useCase === option.id ? 'ob-option selected' : 'ob-option'}
                  onClick={() => setUseCase(option.id)}
                >
                  <Icon size={19} />
                  <strong>{option.label}</strong>
                  <span>{option.body}</span>
                  {useCase === option.id ? <Check size={16} className="ob-option-check" /> : null}
                </button>
              )
            })}
          </div>
          <div className="ob-nav">
            <button className="ghost-button" type="button" onClick={() => setStep('scan')}>
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!useCase}
              onClick={() => setStep('priority')}
            >
              Continue
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'priority' && (
        <section className="ob-stage">
          <span className="ob-eyebrow">Question 2 of 2</span>
          <h1>Faster answers, or smarter answers?</h1>
          <p className="ob-sub">Bigger models think better but reply slower. You can switch models any time.</p>
          <div className="ob-option-grid three">
            {PRIORITY_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  type="button"
                  className={priority === option.id ? 'ob-option selected' : 'ob-option'}
                  onClick={() => setPriority(option.id)}
                >
                  <Icon size={19} />
                  <strong>{option.label}</strong>
                  <span>{option.body}</span>
                  {priority === option.id ? <Check size={16} className="ob-option-check" /> : null}
                </button>
              )
            })}
          </div>
          <div className="ob-nav">
            <button className="ghost-button" type="button" onClick={() => setStep('intent')}>
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (!useCase) return
                fetchRecommendations(useCase, priority)
                setStep('recommend')
              }}
            >
              See my matches
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'recommend' && (
        <section className="ob-stage wide">
          <span className="ob-eyebrow">Matched to {chipLabel} · {formatNumber(ramGb, 0)} GB</span>
          <h1>{recommendations && recommendations.length ? 'Your best models' : 'Finding your best models…'}</h1>
          {recommendations === null ? (
            <p className="ob-sub">Checking what fits your memory and your priorities…</p>
          ) : recommendations.length === 0 ? (
            <div className="ob-floor">
              <p>
                No catalog model comfortably fits this machine's memory. You can still import a small GGUF model of
                your own from the Models tab.
              </p>
              <button className="secondary-button" type="button" onClick={() => onSkipToModels()}>
                Open Models
              </button>
            </div>
          ) : (
            <div className="ob-rec-list">
              {recommendations.map((rec, index) => {
                const isDownloading = downloadingId === rec.model.id && download && !download.error
                const failed = downloadingId === rec.model.id && Boolean(download?.error)
                const pct = download && download.totalSize ? (download.downloadedSize / download.totalSize) * 100 : 0
                return (
                  <article key={rec.model.id} className={index === 0 ? 'ob-rec featured' : 'ob-rec'}>
                    {index === 0 ? (
                      <span className="ob-rec-flag">
                        <BadgeCheck size={14} />
                        Recommended
                      </span>
                    ) : null}
                    <div className="ob-rec-head">
                      <div>
                        <h3>{rec.model.name}</h3>
                        <p>{rec.model.family} · {rec.model.quant} · {rec.model.license}</p>
                      </div>
                      <div className="ob-rec-stats">
                        <span>{formatBytes(rec.model.sizeBytes)}</span>
                        {rec.model.expectedTps ? <span>{rec.model.expectedTps}</span> : null}
                      </div>
                    </div>

                    <ul className="ob-rec-reasons">
                      {rec.reasons.slice(0, 3).map((reason) => (
                        <li key={reason}>
                          <Check size={13} />
                          {reason}
                        </li>
                      ))}
                    </ul>

                    {rec.versusPrimary?.length && recommendations[0] ? (
                      <div className="ob-rec-versus">
                        <strong>vs {recommendations[0].model.name}</strong>
                        <ul>
                          {rec.versusPrimary.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="ob-rec-capability">
                      <div>
                        <strong>Great at</strong>
                        <ul>
                          {rec.model.goodAt.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Will struggle with</strong>
                        <ul>
                          {rec.model.strugglesWith.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {isDownloading ? (
                      <div className="ob-rec-progress">
                        <div className="download-progress-head">
                          <span>{benchmarking ? 'Measuring speed on your machine…' : 'Downloading…'}</span>
                          <strong>
                            {formatBytes(download?.downloadedSize ?? 0)} / {formatBytes(download?.totalSize ?? 0)}
                          </strong>
                        </div>
                        <div className="meter-track medium">
                          <span style={{ width: `${clamp(pct, 2, 100)}%` }} />
                        </div>
                        <p className="ob-rec-progress-note">
                          {benchmarking
                            ? 'Running a short standard generation so every speed number you see is measured, not guessed. Chat is ready the moment this finishes.'
                            : 'When it finishes, PowerStation measures its real speed and drops you straight into chat.'}
                        </p>
                      </div>
                    ) : (
                      <button
                        className="primary-button ob-rec-download"
                        type="button"
                        disabled={Boolean(download) && !download?.error}
                        onClick={() => {
                          startedDownload.current = true
                          setDownloadingId(rec.model.id)
                          onDownload(rec.model.downloadUrl)
                        }}
                      >
                        <Download size={15} />
                        {failed ? 'Retry download' : `Download & set up (${formatBytes(rec.model.sizeBytes)})`}
                      </button>
                    )}
                    {failed && download?.error ? <p className="error-text">{download.error}</p> : null}
                  </article>
                )
              })}
            </div>
          )}
          <div className="ob-nav">
            <button className="ghost-button" type="button" onClick={() => setStep('priority')}>
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => onSkipToModels(useCase ? { useCase, priority } : undefined)}
            >
              I'll pick my own model
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
