import { useRoute } from './router'
import { HomePage } from './ui/HomePage'
import { Link } from './ui/Link'
import { LivePage } from './ui/LivePage'
import { SamplesPage } from './ui/SamplesPage'
import { ViewerPage } from './ui/ViewerPage'

/** Top bar + one page per route. This file does not change after Part 1; parts replace the page files. */
export default function App() {
  const route = useRoute()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>TrueSite</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to="/model" current={route.name === 'viewer'}>Model</Link>
          <Link to="/samples" current={route.name === 'samples'}>Samples</Link>
        </nav>
      </header>
      {route.name === 'home' && <HomePage />}
      {route.name === 'viewer' && <ViewerPage key={route.projectId ?? ''} projectId={route.projectId} />}
      {route.name === 'live' && <LivePage key={`${route.projectId}/${route.anchorId}`} projectId={route.projectId} anchorId={route.anchorId} />}
      {route.name === 'samples' && <SamplesPage />}
    </div>
  )
}
