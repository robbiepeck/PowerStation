import {
  Activity,
  Bot,
  BrainCircuit,
  Bug,
  CalendarClock,
  ExternalLink,
  GitFork,
  HardDrive,
  Leaf,
  LifeBuoy,
  LockKeyhole,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const REPOSITORY_URL = 'https://github.com/robbiepeck/PowerStation'

type GuideSection = {
  title: string
  icon: LucideIcon
  description: string
  usage: string
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    title: 'Chat',
    icon: MessageSquareText,
    description: 'Your private workspace for conversations, attachments, local folder search, projects, and model-assisted work.',
    usage: 'Choose a loaded model, type a prompt, and optionally attach a file or folder. Use projects to keep reusable instructions and knowledge together.',
  },
  {
    title: 'Monitor',
    icon: Activity,
    description: 'A live view of CPU, memory, accelerator, storage, power, battery, and thermal conditions while local AI runs.',
    usage: 'Open it before or during a demanding task. Select CPU, RAM, GPU, VRAM, or storage tiles to see which applications are using that resource.',
  },
  {
    title: 'Models',
    icon: BrainCircuit,
    description: 'The control room for finding, downloading, importing, benchmarking, and replacing your current local model.',
    usage: 'Review the fit assessment before replacing your model. PowerStation keeps one chat model at a time and can use compatible GGUF, Ollama, and LM Studio models.',
  },
  {
    title: 'Utilities',
    icon: Wrench,
    description: 'Configures the agent harness: skills, Model Context Protocol connectors, permissions, and the optional local API.',
    usage: 'Load a model first, then enable only the capabilities it can use reliably. Review connector access and keep tool permissions as narrow as practical.',
  },
  {
    title: 'Agents',
    icon: Bot,
    description: 'Reusable assistants with their own role, instructions, knowledge, skills, connectors, and preferred model.',
    usage: 'Create an agent for a repeated workflow, give it focused context, then start a chat from its card. Export or import agents when you want to share a setup.',
  },
  {
    title: 'Schedules',
    icon: CalendarClock,
    description: 'Runs bounded, recurring local prompts on a timetable and keeps a clear history of each result.',
    usage: 'Create a job, choose its model and schedule, and set safety limits. Scheduled jobs deliberately run without tools or connectors.',
  },
  {
    title: 'Impact',
    icon: Leaf,
    description: 'Makes the environmental cost of local inference, model downloads, storage, and upstream model creation visible.',
    usage: 'Select a model, run real workloads, then compare measured local activity with clearly labelled estimates. Use the storage guidance to reduce avoidable duplication.',
  },
  {
    title: 'Settings',
    icon: Settings,
    description: 'Controls generation defaults, privacy choices, update behaviour, backups, chat storage, and advanced runtime options.',
    usage: 'Set defaults that suit your hardware and risk tolerance. Export a backup before major changes, and use the local API only when another application needs it.',
  },
  {
    title: 'Repair',
    icon: LifeBuoy,
    description: 'Inspects app-owned storage, model integrity, incomplete downloads, indexes, and other recoverable local data.',
    usage: 'Start with a fresh inspection. Review every proposed action before cleaning up; PowerStation limits repairs to data it owns and explains what will change.',
  },
]

const OPEN_SOURCE_LINKS: Array<{ label: string; url: string; icon?: LucideIcon }> = [
  { label: 'Documentation', url: `${REPOSITORY_URL}/tree/main/docs` },
  { label: 'Report an issue', url: `${REPOSITORY_URL}/issues`, icon: Bug },
  { label: 'Contributing guide', url: `${REPOSITORY_URL}/blob/main/CONTRIBUTING.md` },
]

export function AboutView({
  onOpenExternal,
  version,
}: {
  onOpenExternal: (url: string) => void
  version: string | null
}) {
  return (
    <div className="about-view">
      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero-copy">
          <span className="about-eyebrow">About PowerStation</span>
          <h1 id="about-title">Local AI, made legible.</h1>
          <p>
            PowerStation helps you choose an open-weight model that fits your computer, run it locally, and use it
            through chat, retrieval, guarded agent tools, and scheduled work—with honest visibility into the resources
            each workload consumes.
          </p>
          <div className="about-badges" aria-label="Application details">
            <span>{version ? `Version ${version}` : 'Current build'}</span>
            <span>Beta</span>
            <span>MIT licensed</span>
          </div>
        </div>
        <div className="about-identity" aria-hidden="true">
          <div className="about-logo-frame">
            <svg viewBox="0 0 64 64" role="presentation">
              <rect width="64" height="64" rx="12" fill="#11191d" />
              <path d="M36.6 5 17.8 36.4h13.8L27.4 59 46.2 27.6H32.4L36.6 5Z" fill="#f8fbfa" />
              <path d="M43.2 28H32.4l2.1-11.5-10.1 16.9h10.8L33.1 45 43.2 28Z" fill="#008476" />
            </svg>
          </div>
          <span>Runs here.</span>
          <small>Answers stay close.</small>
        </div>
      </section>

      <section className="about-principles" aria-label="PowerStation principles">
        <article>
          <HardDrive size={18} />
          <div>
            <strong>Local by default</strong>
            <span>Models, chats, indexes, and settings remain on your device.</span>
          </div>
        </article>
        <article>
          <ShieldCheck size={18} />
          <div>
            <strong>Honest about fit</strong>
            <span>Memory checks happen before a model is allowed to load.</span>
          </div>
        </article>
        <article>
          <LockKeyhole size={18} />
          <div>
            <strong>Guarded when acting</strong>
            <span>Tools use permissions, previews, capability gates, and loop limits.</span>
          </div>
        </article>
      </section>

      <section className="about-guide" aria-labelledby="about-guide-title">
        <header className="about-section-heading">
          <div>
            <span>Field guide</span>
            <h2 id="about-guide-title">What each section is for</h2>
          </div>
          <p>Follow the left sidebar from conversation to maintenance.</p>
        </header>

        <div className="about-guide-list">
          {GUIDE_SECTIONS.map((section, index) => {
            const Icon = section.icon
            return (
              <article className="about-guide-row" key={section.title}>
                <span className="about-guide-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="about-guide-icon" aria-hidden="true">
                  <Icon size={19} />
                </span>
                <div className="about-guide-copy">
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </div>
                <div className="about-guide-use">
                  <span>How to use it</span>
                  <p>{section.usage}</p>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="about-open-source" aria-labelledby="open-source-title">
        <div className="about-open-source-main">
          <span className="about-github-mark" aria-hidden="true">
            <GitFork size={23} />
          </span>
          <div>
            <span>Open source</span>
            <h2 id="open-source-title">Built in the open, improved together.</h2>
            <p>
              PowerStation is an MIT-licensed project created by Robbie Peck. Read the source, follow development,
              suggest an improvement, or contribute a focused change on GitHub.
            </p>
          </div>
        </div>
        <div className="about-repository-line">
          <code>github.com/robbiepeck/PowerStation</code>
          <button className="about-repository-button" type="button" onClick={() => onOpenExternal(REPOSITORY_URL)}>
            <GitFork size={16} />
            Open repository
            <ExternalLink size={14} />
          </button>
        </div>
        <nav className="about-source-links" aria-label="Open source project links">
          {OPEN_SOURCE_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <button type="button" key={link.label} onClick={() => onOpenExternal(link.url)}>
                {Icon ? <Icon size={14} /> : null}
                {link.label}
                <ExternalLink size={12} />
              </button>
            )
          })}
        </nav>
      </section>

      <footer className="about-footer">
        <span>PowerStation</span>
        <p>Practical local AI for everyday hardware.</p>
      </footer>
    </div>
  )
}
